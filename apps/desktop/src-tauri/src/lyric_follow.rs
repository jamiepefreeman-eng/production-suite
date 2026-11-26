//! Lyric Follow runtime.
//!
//! ```text
//!  [capture thread]  audio device, one channel -> 16 kHz -> ring buffer
//!  [follow thread]   every ~0.9 s: last 6 s -> voice gate -> Whisper -> words
//!                    -> LyricFollower.hear() -> Assist: highlight Next
//!                                               Auto:   engine GoSlide(next)
//!  [events thread]   SlideLive -> LyricFollower.set_slides(prev, live, next)
//! ```
//! Going through the engine means a slide advanced by Lyric Follow fires its
//! lighting and mixer triggers exactly like a manual change.

use crate::state::AppState;
use crate::transcribe;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use suite_core::engine::Command;
use suite_core::presenter::follow::{strip_annotations, tokenize, FollowMode, LyricFollower, SlideRef, SyncKind};
use tauri::{AppHandle, Emitter, Manager, State};

pub const SAMPLE_RATE: u32 = 16_000;
const WINDOW_SECS: usize = 6;
const GATE_SECS: f32 = 1.2;
const STEP: Duration = Duration::from_millis(900);
const PENDING_TIMEOUT_MS: u64 = 2500;

fn now_ms() -> u64 {
    static T0: OnceLock<Instant> = OnceLock::new();
    T0.get_or_init(Instant::now).elapsed().as_millis() as u64
}

/// Which input to listen to. Saved per computer (not in the show file).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FollowInput {
    pub device: String,
    /// 0-based channel of the device (pick the lead vocal on a mixer's USB feed).
    pub channel: u16,
    pub model: PathBuf,
    /// Voice gate: below this level (dBFS) nothing is transcribed. Stops the
    /// speech engine imagining lyrics during instrumentals.
    pub gate_db: f32,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct FollowStatus {
    pub running: bool,
    pub mode: Option<FollowMode>,
    pub input: Option<FollowInput>,
    pub error: Option<String>,
    pub level_db: f32,
    pub voice: bool,
    pub heard: String,
    pub confidence: f32,
    pub live: Option<(u32, u32)>,
    pub next: Option<(u32, u32)>,
    pub sung_word: Option<usize>,
    pub trigger_word: Option<usize>,
    pub in_previous: bool,
    /// Assist mode: the follower would advance now.
    pub ready: bool,
    pub blocked: Option<String>,
    pub reason: Option<String>,
    pub latency_ms: u64,
}

#[derive(Default)]
pub struct FollowRuntime {
    follower: Option<LyricFollower>,
    /// Slide Lyric Follow / "Take" asked for, its place in the play order, and when.
    pending_auto: Option<((u32, u32), usize, u64)>,
    /// Where the live slide is in `Show::play_order` (a repeated chorus appears more than once).
    pos: Option<usize>,
    stop: Option<Arc<AtomicBool>>,
    input: Option<FollowInput>,
    status: FollowStatus,
}

struct Ring {
    buf: VecDeque<f32>,
    cap: usize,
}

impl Ring {
    fn push(&mut self, s: &[f32]) {
        self.buf.extend(s);
        let extra = self.buf.len().saturating_sub(self.cap);
        self.buf.drain(..extra);
    }
    fn last(&self, n: usize) -> Vec<f32> {
        self.buf.iter().skip(self.buf.len().saturating_sub(n)).copied().collect()
    }
}

fn emit(app: &AppHandle, rt: &FollowRuntime) {
    let _ = app.emit("follow-status", &rt.status);
}

// ───────────────────────────────────────────── slide changes (events thread)

/// Called for every SlideLive event.
pub fn on_slide_live(state: &AppState, app: &AppHandle, presentation: u32, slide: u32) {
    let show = state.show();
    let mut rt = state.follow.lock().unwrap();
    let order = show.play_order();
    let pending = rt.pending_auto.take();
    let auto_pos = match pending {
        Some((t, pos, _)) if t == (presentation, slide) => Some(pos),
        _ => None,
    };
    let auto = auto_pos.is_some();
    let kind = if auto { SyncKind::Auto } else { SyncKind::Manual };
    // Place in the play order: the one we advanced to, else the next occurrence after where we were.
    let pos = auto_pos.or_else(|| suite_core::show::Show::locate(&order, (presentation, slide), rt.pos));
    let was = rt.pos;
    rt.pos = pos;
    let at = |i: Option<usize>| i.and_then(|i| order.get(i).copied());
    let slide_ref = |ps: Option<(u32, u32)>| ps.and_then(|(p, s)| show.slide_text(p, s).map(|t| SlideRef { presentation: p, slide: s, text: t }));
    let settings = show.lyric_follow.clone();
    let live_text = show.slide_text(presentation, slide).unwrap_or("");
    let prev = slide_ref(at(pos.and_then(|i| i.checked_sub(1))));
    let next = slide_ref(at(pos.map(|i| i + 1)));
    let f = rt.follower.get_or_insert_with(|| LyricFollower::new(settings.clone()));
    f.set_settings(settings);
    // Only keep listening through the old slide's tail if we really came from it.
    let came_from_prev = auto && f.live().is_some() && pos.is_some() && was.map(|w| w + 1) == pos;
    f.set_slides(
        if came_from_prev { prev } else { None },
        SlideRef { presentation, slide, text: live_text },
        next,
        now_ms(),
        if came_from_prev { kind } else { SyncKind::Manual },
    );
    let (live, nxt, trig) = (f.live(), f.next(), f.trigger_word());
    rt.status.live = live;
    rt.status.next = nxt;
    rt.status.trigger_word = trig;
    rt.status.sung_word = None;
    rt.status.ready = false;
    rt.status.reason = None;
    rt.status.blocked = if kind == SyncKind::Manual && rt.status.running && settings_mode(&show) == FollowMode::Auto {
        Some("paused after a manual slide change".into())
    } else {
        None
    };
    emit(app, &rt);
}

pub fn on_slide_cleared(state: &AppState, app: &AppHandle) {
    let mut rt = state.follow.lock().unwrap();
    if let Some(f) = rt.follower.as_mut() {
        f.clear();
    }
    rt.status.live = None;
    rt.status.next = None;
    rt.status.ready = false;
    rt.pos = None;
    emit(app, &rt);
}

/// Settings may have changed (words early, mode…): apply them right away.
pub fn on_show_changed(state: &AppState, app: &AppHandle) {
    let show = state.show();
    {
        let mut rt = state.follow.lock().unwrap();
        rt.status.mode = Some(show.lyric_follow.mode);
        if let Some(f) = rt.follower.as_mut() {
            f.set_settings(show.lyric_follow.clone());
            let t = f.trigger_word();
            rt.status.trigger_word = t;
        }
        emit(app, &rt);
    }
    // Switching the mode to Off stops listening.
    if show.lyric_follow.mode == FollowMode::Off && state.follow.lock().unwrap().stop.is_some() {
        stop(state, app);
    }
}

fn settings_mode(show: &suite_core::show::Show) -> FollowMode {
    show.lyric_follow.mode
}

// ───────────────────────────────────────────── audio capture

#[cfg(feature = "audio")]
fn spawn_capture(input: &FollowInput, ring: Arc<Mutex<Ring>>, stop: Arc<AtomicBool>, state: Arc<AppState>) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{FromSample, SampleFormat, SizedSample};
    use suite_core::audio::Resampler;

    fn find(name: &str) -> Option<cpal::Device> {
        cpal::available_hosts().into_iter().filter_map(|h| cpal::host_from_id(h).ok()).find_map(|host| {
            host.input_devices().ok()?.find(|d| d.name().map(|n| n == name).unwrap_or(false))
        })
    }

    fn build<T>(
        device: &cpal::Device,
        cfg: &cpal::StreamConfig,
        channel: usize,
        ring: Arc<Mutex<Ring>>,
        state: Arc<AppState>,
    ) -> Result<cpal::Stream, cpal::BuildStreamError>
    where
        T: SizedSample,
        f32: FromSample<T>,
    {
        let channels = cfg.channels as usize;
        let mut rs = Resampler::new(cfg.sample_rate.0, SAMPLE_RATE);
        let mut mono: Vec<f32> = Vec::with_capacity(4096);
        let mut out: Vec<f32> = Vec::with_capacity(2048);
        device.build_input_stream(
            cfg,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                mono.clear();
                out.clear();
                mono.extend(data.chunks(channels).map(|f| f[channel.min(f.len() - 1)].to_sample::<f32>()));
                rs.process(&mono, &mut out);
                if let Ok(mut r) = ring.lock() {
                    r.push(&out);
                }
            },
            move |e| {
                if let Ok(mut rt) = state.follow.lock() {
                    rt.status.error = Some(format!("Audio input error: {e}"));
                }
            },
            None,
        )
    }

    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
    let input = input.clone();
    std::thread::Builder::new()
        .name("follow-capture".into())
        .spawn(move || {
            let run = || -> Result<cpal::Stream, String> {
                let device = find(&input.device).ok_or_else(|| format!("Audio input '{}' not found", input.device))?;
                let sc = device.default_input_config().map_err(|e| e.to_string())?;
                let cfg: cpal::StreamConfig = sc.config();
                let ch = input.channel as usize;
                if ch >= cfg.channels as usize {
                    return Err(format!("'{}' only has {} input channel(s)", input.device, cfg.channels));
                }
                let stream = match sc.sample_format() {
                    SampleFormat::F32 => build::<f32>(&device, &cfg, ch, ring, state),
                    SampleFormat::I16 => build::<i16>(&device, &cfg, ch, ring, state),
                    SampleFormat::U16 => build::<u16>(&device, &cfg, ch, ring, state),
                    SampleFormat::I32 => build::<i32>(&device, &cfg, ch, ring, state),
                    f => return Err(format!("Unsupported sample format {f:?}")),
                }
                .map_err(|e| e.to_string())?;
                stream.play().map_err(|e| e.to_string())?;
                Ok(stream)
            };
            match run() {
                Ok(stream) => {
                    let _ = tx.send(Ok(()));
                    // The stream must live on this thread (it isn't Send on every OS).
                    while !stop.load(Ordering::SeqCst) {
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    drop(stream);
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "Audio input didn't start".to_string())?
}

#[cfg(not(feature = "audio"))]
fn spawn_capture(_: &FollowInput, _: Arc<Mutex<Ring>>, _: Arc<AtomicBool>, _: Arc<AppState>) -> Result<(), String> {
    Err("This build doesn't include audio input".into())
}

// ───────────────────────────────────────────── listen + decide

fn spawn_follow(state: Arc<AppState>, app: AppHandle, model: PathBuf, ring: Arc<Mutex<Ring>>, stop: Arc<AtomicBool>) {
    std::thread::Builder::new()
        .name("follow".into())
        .spawn(move || {
            let mut tx = match transcribe::load(&model) {
                Ok(t) => t,
                Err(e) => {
                    let mut rt = state.follow.lock().unwrap();
                    rt.status.error = Some(e);
                    rt.status.running = false;
                    stop.store(true, Ordering::SeqCst);
                    emit(&app, &rt);
                    return;
                }
            };
            while !stop.load(Ordering::SeqCst) {
                let started = Instant::now();
                let (samples, gate_samples) = {
                    let r = ring.lock().unwrap();
                    (r.last(SAMPLE_RATE as usize * WINDOW_SECS), r.last((SAMPLE_RATE as f32 * GATE_SECS) as usize))
                };
                let level = suite_core::audio::rms_dbfs(&gate_samples);
                let (gate, prompt) = {
                    let mut rt = state.follow.lock().unwrap();
                    rt.status.level_db = level;
                    let gate = rt.input.as_ref().map(|i| i.gate_db).unwrap_or(-45.0);
                    let prompt = rt
                        .follower
                        .as_ref()
                        .filter(|f| f.settings().bias_prompt && f.live().is_some())
                        .map(|f| f.prompt_text(40));
                    (gate, prompt)
                };
                let voice = level >= gate && samples.len() >= SAMPLE_RATE as usize;
                if voice {
                    match tx.transcribe(&samples, prompt.as_deref()) {
                        Ok(text) => handle_text(&state, &text, started.elapsed().as_millis() as u64),
                        Err(e) => state.follow.lock().unwrap().status.error = Some(e),
                    }
                }
                {
                    let mut rt = state.follow.lock().unwrap();
                    rt.status.voice = voice;
                    emit(&app, &rt);
                }
                if let Some(rest) = STEP.checked_sub(started.elapsed()) {
                    std::thread::sleep(rest);
                }
            }
        })
        .expect("spawn follow thread");
}

fn handle_text(state: &AppState, text: &str, latency_ms: u64) {
    let words = tokenize(&strip_annotations(text));
    let now = now_ms();
    let mode = state.engine.lock().unwrap().show.lyric_follow.mode;
    let mut go: Option<(u32, u32)> = None;
    {
        let mut rt = state.follow.lock().unwrap();
        rt.status.heard = text.trim().to_string();
        rt.status.latency_ms = latency_ms;
        rt.status.error = None;
        if let Some((_, _, since)) = rt.pending_auto {
            if now > since + PENDING_TIMEOUT_MS {
                rt.pending_auto = None;
            }
        }
        let Some(f) = rt.follower.as_mut() else { return };
        let up = f.hear(&words, now);
        rt.status.confidence = up.confidence;
        rt.status.sung_word = up.sung_word;
        rt.status.trigger_word = up.trigger_word;
        rt.status.in_previous = up.in_previous;
        rt.status.ready = up.advance.as_ref().is_some_and(|a| a.allowed);
        rt.status.blocked = up.advance.as_ref().and_then(|a| a.blocked.clone());
        rt.status.reason = up.advance.as_ref().map(|a| a.reason.clone());
        if let (FollowMode::Auto, Some(a)) = (mode, up.advance) {
            if a.allowed && rt.pending_auto.is_none() {
                let next_pos = rt.pos.map(|p| p + 1).unwrap_or(0);
                rt.pending_auto = Some(((a.presentation, a.slide), next_pos, now));
                go = Some((a.presentation, a.slide));
            }
        }
    }
    // Dispatch outside the follow lock (the events thread will need it).
    if let Some((presentation, slide)) = go {
        state.dispatch(Command::GoSlide { presentation, slide });
    }
}

fn stop(state: &AppState, app: &AppHandle) {
    let mut rt = state.follow.lock().unwrap();
    if let Some(s) = rt.stop.take() {
        s.store(true, Ordering::SeqCst);
    }
    rt.status.running = false;
    rt.status.voice = false;
    rt.status.ready = false;
    emit(app, &rt);
}

// ───────────────────────────────────────────── commands

/// Async + blocking pool: opening the audio input waits for the device (up to 5 s), and a sync
/// command would freeze the window meanwhile (CLAUDE.md rule 7).
#[tauri::command]
pub async fn follow_start(app: AppHandle, state: State<'_, Arc<AppState>>, input: FollowInput) -> Result<FollowStatus, String> {
    let st: Arc<AppState> = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || start_blocking(st, app, input)).await.map_err(|e| e.to_string())?
}

fn start_blocking(st: Arc<AppState>, app: AppHandle, input: FollowInput) -> Result<FollowStatus, String> {
    stop(&st, &app);
    if !input.model.exists() {
        return Err("Download a speech model first".into());
    }
    let ring = Arc::new(Mutex::new(Ring { buf: VecDeque::new(), cap: SAMPLE_RATE as usize * (WINDOW_SECS + 1) }));
    let flag = Arc::new(AtomicBool::new(false));
    spawn_capture(&input, ring.clone(), flag.clone(), st.clone())?;
    {
        let mut rt = st.follow.lock().unwrap();
        rt.stop = Some(flag.clone());
        rt.input = Some(input.clone());
        rt.status.running = true;
        rt.status.error = None;
        rt.status.input = Some(input.clone());
    }
    spawn_follow(st.clone(), app.clone(), input.model.clone(), ring, flag);
    // Remember this computer's choice.
    {
        let mut s = st.settings.lock().unwrap();
        s.follow_input = Some(input);
        let _ = s.save(&app);
    }
    // Pick up whatever slide is already live.
    let live = st.engine.lock().unwrap().live_slide();
    if let Some((p, s)) = live {
        on_slide_live(&st, &app, p, s);
    }
    let status = st.follow.lock().unwrap().status.clone();
    Ok(status)
}

#[tauri::command]
pub fn follow_stop(app: AppHandle, state: State<'_, Arc<AppState>>) -> FollowStatus {
    stop(&state, &app);
    state.follow.lock().unwrap().status.clone()
}

#[tauri::command]
pub fn follow_status(state: State<'_, Arc<AppState>>) -> FollowStatus {
    let mut rt = state.follow.lock().unwrap();
    if rt.status.input.is_none() {
        rt.status.input = state.settings.lock().unwrap().follow_input.clone();
    }
    rt.status.mode = Some(state.engine.lock().unwrap().show.lyric_follow.mode);
    rt.status.clone()
}

#[tauri::command]
pub fn follow_set_gate(app: AppHandle, state: State<'_, Arc<AppState>>, gate_db: f32) {
    let mut rt = state.follow.lock().unwrap();
    if let Some(i) = rt.input.as_mut() {
        i.gate_db = gate_db;
    }
    if let Some(i) = rt.status.input.as_mut() {
        i.gate_db = gate_db;
    }
    let mut s = state.settings.lock().unwrap();
    if let Some(i) = s.follow_input.as_mut() {
        i.gate_db = gate_db;
        let _ = s.save(&app);
    }
}

/// Assist mode: the operator accepts "next". Treated like an auto advance so
/// the follower keeps listening through the end of the old slide.
#[tauri::command]
pub fn follow_take(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let target = {
        let mut rt = state.follow.lock().unwrap();
        let next = rt.follower.as_ref().and_then(|f| f.next()).ok_or("No next slide")?;
        let next_pos = rt.pos.map(|p| p + 1).unwrap_or(0);
        rt.pending_auto = Some((next, next_pos, now_ms()));
        next
    };
    state.dispatch(Command::GoSlide { presentation: target.0, slide: target.1 });
    Ok(())
}

// ───────────────────────────────────────────── speech models

const MODELS: &[(&str, u32, &str)] = &[
    ("tiny.en", 75, "Fastest, least accurate — older/slow PCs"),
    ("base.en", 142, "Recommended for most computers"),
    ("small.en", 466, "More accurate — Apple Silicon Macs or PCs with a good GPU"),
];

#[derive(Serialize)]
pub struct ModelInfo {
    pub name: String,
    pub size_mb: u32,
    pub note: String,
    pub path: PathBuf,
    pub downloaded: bool,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("models"))
}

#[tauri::command]
pub fn follow_models(app: AppHandle) -> Result<Vec<ModelInfo>, String> {
    let dir = models_dir(&app)?;
    Ok(MODELS
        .iter()
        .map(|(name, mb, note)| {
            let path = dir.join(format!("ggml-{name}.bin"));
            ModelInfo { name: name.to_string(), size_mb: *mb, note: note.to_string(), downloaded: path.exists(), path }
        })
        .collect())
}

#[derive(Serialize, Clone)]
pub struct Progress {
    pub name: String,
    pub downloaded: u64,
    pub total: Option<u64>,
}

#[tauri::command]
pub async fn follow_download_model(app: AppHandle, name: String) -> Result<PathBuf, String> {
    if !MODELS.iter().any(|(n, _, _)| *n == name) {
        return Err(format!("Unknown model {name}"));
    }
    let dir = models_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("ggml-{name}.bin"));
    let part = dir.join(format!("ggml-{name}.bin.part"));
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{name}.bin");
    let mut resp = reqwest::get(&url).await.map_err(|e| format!("Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length();
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut done: u64 = 0;
    let mut last_emit = 0u64;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Download interrupted: {e}"))? {
        std::io::Write::write_all(&mut file, &chunk).map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        if done - last_emit > 2_000_000 {
            last_emit = done;
            let _ = app.emit("follow-model-progress", Progress { name: name.clone(), downloaded: done, total });
        }
    }
    drop(file);
    std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
    let _ = app.emit("follow-model-progress", Progress { name, downloaded: done, total: Some(done) });
    Ok(path)
}
