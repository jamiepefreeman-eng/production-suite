//! The show engine: one place that owns state and turns commands from any
//! module into events for every module.
//!
//! ```text
//!  Presenter ─┐                         ┌─> Presenter (live slide)
//!  Lighting  ─┼─ Command ─> Engine ─ Event ─┼─> Lighting  (programmer, cues)
//!  Audio     ─┤                         ├─> Audio     (MixerOut -> desk)
//!  Visualizer┘           frame(now) ──> DMX outputs + Visualizer
//! ```

use crate::ai::{self, Intent};
use crate::dmx::DmxFrame;
use crate::lighting::{render_look, Cue, FixtureState, Look, PanTilt, PositionPreset};
use crate::mixer::MixerCommand;
use crate::presenter::{ClearLayer, SlideTrigger};
use crate::show::Show;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Presenter layers besides the slide text, ProPresenter-style: each can be
/// cleared on its own.
#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Layers {
    /// Image / video from the media bin, shown behind the slide text
    /// (replaces the theme background while set).
    pub media: Option<u32>,
    /// Audio from the media bin; the main window plays it.
    pub audio: Option<u32>,
    pub audio_loop: bool,
    pub countdown: Option<Countdown>,
    /// Props showing, in the order they were turned on.
    #[cfg_attr(feature = "serde", serde(default))]
    pub props: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Countdown {
    pub label: String,
    /// Wall-clock end time, so every window counts down to the same moment.
    pub ends_at_unix_ms: u64,
    pub show_on_audience: bool,
}

fn unix_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "type", rename_all = "snake_case"))]
pub enum Command {
    // ── Presenter
    GoSlide { presentation: u32, slide: u32 },
    ClearSlide,
    /// Background media layer (`None` clears it).
    SetMedia { media: Option<u32> },
    /// Audio layer (`None` stops it).
    PlayAudio { audio: Option<u32>, looped: bool },
    StartCountdown { label: String, seconds: u32, show_on_audience: bool },
    ClearCountdown,
    /// Slide, media, audio, props and countdown (not lighting).
    ClearAll,
    SetProp { prop: u32, on: bool },
    ClearProps,
    RunMacro { id: u32 },
    // ── Lighting
    GoCue { cue: u32 },
    ReleaseCue,
    Blackout { on: bool },
    GrandMaster { level: f32 },
    ClearProgrammer,
    /// Plain-language sentence, parsed offline, applied to the programmer.
    ApplyText { text: String },
    /// Intents from the LLM (or anywhere), applied to the programmer.
    ApplyIntents { intents: Vec<Intent>, unknown: Vec<String>, source: Option<String> },
    /// Direct programmer edit (faders, pan/tilt pads); merged over what's there.
    SetFixtureState { fixtures: Vec<u32>, state: FixtureState },
    /// Set many fixtures to different states in one go (e.g. "match background", ~10×/s).
    MergeProgrammer { look: Look },
    RecordCue { name: String, fade_ms: u32 },
    DeleteCue { cue: u32 },
    /// Store the programmer's current pan/tilt as a named focus position.
    RecordPosition { name: String },
    MoveFixture { fixture: u32, position: [f32; 3], rotation: [f32; 3] },
    // ── Audio
    Mixer { command: MixerCommand },
    // ── Show
    /// Start fresh with a new show (clears programmer and playback).
    LoadShow { show: Show },
    /// Replace the show after an edit in any module, keeping what's live.
    ReplaceShow { show: Show },
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "type", rename_all = "snake_case"))]
pub enum Event {
    ShowChanged,
    LayersChanged { layers: Layers },
    SlideLive { presentation: u32, slide: u32, title: String, label: String, text: String },
    SlideCleared,
    CueFired { cue: u32, name: String },
    CueReleased,
    ProgrammerChanged { look: Look },
    SceneBuilt { applied: Vec<String>, issues: Vec<String>, unknown: Vec<String> },
    BlackoutChanged { on: bool },
    /// The app layer forwards this to the connected desk.
    MixerOut { command: MixerCommand },
    Log { level: LogLevel, message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum LogLevel {
    Info,
    Warn,
}

fn info(m: impl Into<String>) -> Event {
    Event::Log { level: LogLevel::Info, message: m.into() }
}
fn warn(m: impl Into<String>) -> Event {
    Event::Log { level: LogLevel::Warn, message: m.into() }
}

struct Fade {
    from: DmxFrame,
    start: Instant,
    duration: Duration,
}

pub struct Engine {
    pub show: Show,
    pub programmer: Look,
    playback: Look,
    active_cue: Option<u32>,
    live_slide: Option<(u32, u32)>,
    layers: Layers,
    grand_master: f32,
    blackout: bool,
    fade: Option<Fade>,
    last_output: DmxFrame,
}

impl Engine {
    pub fn new(show: Show) -> Self {
        Self {
            show,
            programmer: Look::default(),
            playback: Look::default(),
            active_cue: None,
            live_slide: None,
            layers: Layers::default(),
            grand_master: 1.0,
            blackout: false,
            fade: None,
            last_output: DmxFrame::default(),
        }
    }

    pub fn active_cue(&self) -> Option<u32> {
        self.active_cue
    }

    pub fn live_slide(&self) -> Option<(u32, u32)> {
        self.live_slide
    }

    pub fn layers(&self) -> &Layers {
        &self.layers
    }

    fn media_ok(&self, id: Option<u32>, ev: &mut Vec<Event>) -> bool {
        match id {
            Some(id) if !self.show.media.iter().any(|m| m.id == id) => {
                ev.push(warn(format!("No media #{id} in the bin")));
                false
            }
            _ => true,
        }
    }

    pub fn last_output(&self) -> &DmxFrame {
        &self.last_output
    }

    pub fn handle(&mut self, cmd: Command, now: Instant) -> Vec<Event> {
        let mut ev = Vec::new();
        match cmd {
            Command::GoSlide { presentation, slide } => self.go_slide(presentation, slide, now, &mut ev),
            Command::ClearSlide => {
                self.live_slide = None;
                ev.push(Event::SlideCleared);
            }
            Command::SetMedia { media } => {
                if self.media_ok(media, &mut ev) {
                    self.layers.media = media;
                    ev.push(Event::LayersChanged { layers: self.layers.clone() });
                }
            }
            Command::PlayAudio { audio, looped } => {
                if self.media_ok(audio, &mut ev) {
                    self.layers.audio = audio;
                    self.layers.audio_loop = looped;
                    ev.push(Event::LayersChanged { layers: self.layers.clone() });
                }
            }
            Command::StartCountdown { label, seconds, show_on_audience } => {
                self.layers.countdown =
                    Some(Countdown { label, ends_at_unix_ms: unix_ms() + seconds as u64 * 1000, show_on_audience });
                ev.push(Event::LayersChanged { layers: self.layers.clone() });
            }
            Command::ClearCountdown => {
                self.layers.countdown = None;
                ev.push(Event::LayersChanged { layers: self.layers.clone() });
            }
            Command::ClearAll => self.run_trigger(SlideTrigger::Clear { layer: ClearLayer::All }, now, &mut ev, 0),
            Command::SetProp { prop, on } => self.run_trigger(SlideTrigger::Prop { prop, on }, now, &mut ev, 0),
            Command::ClearProps => self.run_trigger(SlideTrigger::Clear { layer: ClearLayer::Props }, now, &mut ev, 0),
            Command::RunMacro { id } => self.run_trigger(SlideTrigger::Macro { id }, now, &mut ev, 0),
            Command::GoCue { cue } => self.go_cue(cue, now, &mut ev),
            Command::ReleaseCue => {
                self.start_fade(now, 1000);
                self.playback.clear();
                self.active_cue = None;
                ev.push(Event::CueReleased);
            }
            Command::Blackout { on } => {
                self.start_fade(now, 0);
                self.blackout = on;
                ev.push(Event::BlackoutChanged { on });
            }
            Command::GrandMaster { level } => self.grand_master = level.clamp(0.0, 1.0),
            Command::ClearProgrammer => {
                self.programmer.clear();
                ev.push(Event::ProgrammerChanged { look: self.programmer.clone() });
            }
            Command::ApplyText { text } => {
                let parsed = ai::parse(&self.show, &text);
                self.apply_intents(&parsed.intents, parsed.unknown, &mut ev);
            }
            Command::ApplyIntents { intents, unknown, source } => {
                if let Some(s) = source {
                    ev.push(info(format!("AI: {s}")));
                }
                self.apply_intents(&intents, unknown, &mut ev);
            }
            Command::SetFixtureState { fixtures, state } => {
                for id in fixtures {
                    let cur = self.programmer.fixtures.get(&id).cloned().unwrap_or_default();
                    self.programmer.fixtures.insert(id, cur.merged(&state));
                }
                ev.push(Event::ProgrammerChanged { look: self.programmer.clone() });
            }
            Command::MergeProgrammer { look } => {
                self.programmer = self.programmer.merged(&look);
                ev.push(Event::ProgrammerChanged { look: self.programmer.clone() });
            }
            Command::RecordCue { name, fade_ms } => {
                let look = self.playback.merged(&self.programmer);
                if look.is_empty() {
                    ev.push(warn("Nothing to record — the programmer and playback are empty"));
                } else {
                    let id = self.show.next_cue_id();
                    self.show.cues.push(Cue { id, name: name.clone(), look: look.clone(), fade_ms, source_text: None });
                    self.programmer.clear();
                    self.playback = look;
                    self.active_cue = Some(id);
                    ev.push(Event::ShowChanged);
                    ev.push(Event::ProgrammerChanged { look: self.programmer.clone() });
                    ev.push(Event::CueFired { cue: id, name });
                }
            }
            Command::DeleteCue { cue } => {
                self.show.cues.retain(|c| c.id != cue);
                ev.push(Event::ShowChanged);
            }
            Command::RecordPosition { name } => {
                let values: Vec<PanTilt> = self
                    .programmer
                    .fixtures
                    .iter()
                    .filter_map(|(id, st)| match (st.pan, st.tilt) {
                        (Some(pan), Some(tilt)) => Some(PanTilt { fixture: *id, pan, tilt }),
                        _ => None,
                    })
                    .collect();
                if values.is_empty() {
                    ev.push(warn("Set pan/tilt on some movers in the programmer first"));
                } else {
                    let n = values.len();
                    if let Some(p) = self.show.positions.iter_mut().find(|p| p.name.eq_ignore_ascii_case(&name)) {
                        for v in values {
                            p.values.retain(|o| o.fixture != v.fixture);
                            p.values.push(v);
                        }
                    } else {
                        self.show.positions.push(PositionPreset { name: name.clone(), aliases: vec![], values });
                    }
                    ev.push(Event::ShowChanged);
                    ev.push(info(format!("Stored position '{name}' for {n} fixture(s)")));
                }
            }
            Command::MoveFixture { fixture, position, rotation } => {
                if let Some(f) = self.show.fixture_mut(fixture) {
                    f.position = position;
                    f.rotation = rotation;
                    ev.push(Event::ShowChanged);
                }
            }
            Command::Mixer { command } => ev.push(Event::MixerOut { command }),
            Command::ReplaceShow { show } => {
                self.show = show;
                ev.push(Event::ShowChanged);
            }
            Command::LoadShow { show } => {
                *self = Engine::new(show);
                for w in self.show.patch_warnings() {
                    ev.push(warn(w));
                }
                ev.push(Event::ShowChanged);
            }
        }
        ev
    }

    fn go_slide(&mut self, presentation: u32, slide: u32, now: Instant, ev: &mut Vec<Event>) {
        let Some(p) = self.show.presentation(presentation) else {
            ev.push(warn(format!("No presentation #{presentation}")));
            return;
        };
        let Some(s) = p.slide(slide) else {
            ev.push(warn(format!("No slide #{slide} in {}", p.title)));
            return;
        };
        let (title, label, text, triggers) = (p.title.clone(), s.label.clone(), s.text.clone(), s.triggers.clone());
        self.live_slide = Some((presentation, slide));
        ev.push(Event::SlideLive { presentation, slide, title, label, text });
        for t in triggers {
            self.run_trigger(t, now, ev, 0);
        }
    }

    /// One slide action / macro step. `depth` stops macros that call each other forever.
    fn run_trigger(&mut self, t: SlideTrigger, now: Instant, ev: &mut Vec<Event>, depth: u8) {
        let layers_before = self.layers.clone();
        match t {
            SlideTrigger::LightingCue { cue } => self.go_cue(cue, now, ev),
            SlideTrigger::LightingText { text } => {
                let parsed = ai::parse(&self.show, &text);
                let res = ai::resolve(&self.show, &parsed.intents, &self.playback);
                self.start_fade(now, 1000);
                self.playback = self.playback.merged(&res.look);
                for i in res.issues.iter().chain(parsed.unknown.iter()) {
                    ev.push(warn(format!("Slide lighting: {i}")));
                }
            }
            SlideTrigger::Blackout => {
                self.start_fade(now, 0);
                self.blackout = true;
                ev.push(Event::BlackoutChanged { on: true });
            }
            SlideTrigger::Mixer { command } => ev.push(Event::MixerOut { command }),
            SlideTrigger::Media { media } => {
                if self.media_ok(media, ev) {
                    self.layers.media = media;
                }
            }
            SlideTrigger::Audio { audio, looped } => {
                if self.media_ok(audio, ev) {
                    self.layers.audio = audio;
                    self.layers.audio_loop = looped;
                }
            }
            SlideTrigger::Prop { prop, on } => {
                if !self.show.props.iter().any(|p| p.id == prop) {
                    ev.push(warn(format!("No prop #{prop}")));
                } else if on && !self.layers.props.contains(&prop) {
                    self.layers.props.push(prop);
                } else if !on {
                    self.layers.props.retain(|p| *p != prop);
                }
            }
            SlideTrigger::Macro { id } => {
                let Some(m) = self.show.macros.iter().find(|m| m.id == id).cloned() else {
                    ev.push(warn(format!("No macro #{id}")));
                    return;
                };
                if depth >= 4 {
                    ev.push(warn(format!("Macro “{}” calls too many other macros — stopped", m.name)));
                    return;
                }
                ev.push(info(format!("Macro: {}", m.name)));
                for a in m.actions {
                    self.run_trigger(a, now, ev, depth + 1);
                }
            }
            SlideTrigger::Clear { layer } => match layer {
                ClearLayer::All => {
                    if self.live_slide.take().is_some() {
                        ev.push(Event::SlideCleared);
                    }
                    self.layers = Layers::default();
                }
                ClearLayer::Slide => {
                    self.live_slide = None;
                    ev.push(Event::SlideCleared);
                }
                ClearLayer::Media => self.layers.media = None,
                ClearLayer::Audio => self.layers.audio = None,
                ClearLayer::Props => self.layers.props.clear(),
                ClearLayer::Timer => self.layers.countdown = None,
                ClearLayer::Lights => {
                    self.start_fade(now, 1000);
                    self.playback.clear();
                    self.active_cue = None;
                    ev.push(Event::CueReleased);
                }
            },
        }
        // Macro steps (depth > 0) are announced once, by the call that started the macro.
        if depth == 0 && self.layers != layers_before {
            ev.push(Event::LayersChanged { layers: self.layers.clone() });
        }
    }

    fn go_cue(&mut self, cue: u32, now: Instant, ev: &mut Vec<Event>) {
        let Some(c) = self.show.cue(cue).cloned() else {
            ev.push(warn(format!("No lighting cue #{cue}")));
            return;
        };
        self.start_fade(now, c.fade_ms);
        self.playback = c.look;
        self.active_cue = Some(c.id);
        self.blackout = false;
        if !self.programmer.is_empty() {
            self.programmer.clear();
            ev.push(Event::ProgrammerChanged { look: self.programmer.clone() });
        }
        ev.push(Event::CueFired { cue: c.id, name: c.name });
    }

    fn apply_intents(&mut self, intents: &[Intent], mut unknown: Vec<String>, ev: &mut Vec<Event>) {
        let base = self.playback.merged(&self.programmer);
        let res = ai::resolve(&self.show, intents, &base);
        self.programmer = self.programmer.merged(&res.look);
        ev.push(Event::ProgrammerChanged { look: self.programmer.clone() });
        unknown.dedup();
        ev.push(Event::SceneBuilt { applied: res.applied, issues: res.issues, unknown });
    }

    fn start_fade(&mut self, now: Instant, ms: u32) {
        self.fade = if ms == 0 {
            None
        } else {
            Some(Fade { from: self.last_output.clone(), start: now, duration: Duration::from_millis(ms as u64) })
        };
    }

    /// Render the current output. Call at the DMX refresh rate (~40 Hz).
    pub fn frame(&mut self, now: Instant) -> DmxFrame {
        let mut look = self.playback.merged(&self.programmer);
        let master = if self.blackout { 0.0 } else { self.grand_master };
        if master < 1.0 {
            for st in look.fixtures.values_mut() {
                st.intensity = st.intensity.map(|i| i * master);
            }
        }
        let target = render_look(&self.show, &look);
        // TODO: proper HTP/LTP and 16-bit-aware pan/tilt fades.
        let out = match &self.fade {
            Some(f) => {
                let t = now.saturating_duration_since(f.start).as_secs_f32() / f.duration.as_secs_f32();
                if t >= 1.0 {
                    self.fade = None;
                    target
                } else {
                    DmxFrame::lerp(&f.from, &target, t)
                }
            }
            None => target,
        };
        self.last_output = out.clone();
        out
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn merge_programmer_sets_each_fixture_and_keeps_the_rest() {
        use crate::lighting::look::{FixtureState, Look};
        use crate::lighting::Rgb;
        let mut e = super::Engine::new(crate::demo::demo_show());
        let now = std::time::Instant::now();
        e.handle(super::Command::SetFixtureState { fixtures: vec![1], state: FixtureState { gobo: Some(2), ..Default::default() } }, now);
        let mut look = Look::default();
        look.fixtures.insert(1, FixtureState { color: Some(Rgb { r: 1.0, g: 0.5, b: 0.0 }), intensity: Some(0.8), ..Default::default() });
        look.fixtures.insert(2, FixtureState { color: Some(Rgb { r: 0.0, g: 0.0, b: 1.0 }), ..Default::default() });
        let ev = e.handle(super::Command::MergeProgrammer { look }, now);
        assert_eq!(ev.len(), 1);
        let p = &e.programmer.fixtures;
        assert_eq!(p[&1].gobo, Some(2));
        assert_eq!(p[&1].intensity, Some(0.8));
        assert_eq!(p[&2].color, Some(Rgb { r: 0.0, g: 0.0, b: 1.0 }));
    }

    #[test]
    fn macros_run_steps_and_props_toggle() {
        let mut e = super::Engine::new(crate::demo::demo_show());
        let now = std::time::Instant::now();
        e.handle(super::Command::GoSlide { presentation: 1, slide: 1 }, now);
        let ev = e.handle(super::Command::RunMacro { id: 1 }, now); // Walk-in: clear all, cue 1, logo, mixer
        assert_eq!(e.live_slide(), None);
        assert_eq!(e.active_cue(), Some(1));
        assert_eq!(e.layers().props, vec![1]);
        assert!(ev.iter().any(|x| matches!(x, super::Event::MixerOut { .. })));
        assert_eq!(ev.iter().filter(|x| matches!(x, super::Event::LayersChanged { .. })).count(), 1);
        e.handle(super::Command::SetProp { prop: 2, on: true }, now);
        assert_eq!(e.layers().props, vec![1, 2]);
        e.handle(super::Command::SetProp { prop: 1, on: false }, now);
        assert_eq!(e.layers().props, vec![2]);
        e.handle(super::Command::ClearAll, now);
        assert!(e.layers().props.is_empty());
    }

    #[test]
    fn macro_that_calls_itself_stops() {
        let mut show = crate::demo::demo_show();
        show.macros.push(crate::presenter::Macro { id: 9, name: "Loop".into(), color: "#fff".into(), actions: vec![crate::presenter::SlideTrigger::Macro { id: 9 }] });
        let mut e = super::Engine::new(show);
        let ev = e.handle(super::Command::RunMacro { id: 9 }, std::time::Instant::now());
        assert!(ev.iter().any(|x| matches!(x, super::Event::Log { message, .. } if message.contains("too many"))));
    }

    #[test]
    fn layers_set_and_clear_all() {
        let mut show = crate::demo::demo_show();
        show.media.push(crate::presenter::MediaItem {
            id: 7,
            name: "Loop".into(),
            path: "/x/loop.mp4".into(),
            kind: crate::presenter::MediaKind::Video,
        });
        let mut e = super::Engine::new(show);
        let now = std::time::Instant::now();
        e.handle(super::Command::SetMedia { media: Some(7) }, now);
        assert_eq!(e.layers().media, Some(7));
        // Unknown media is refused with a warning, not applied.
        let ev = e.handle(super::Command::SetMedia { media: Some(99) }, now);
        assert_eq!(e.layers().media, Some(7));
        assert!(ev.iter().any(|x| matches!(x, super::Event::Log { .. })));
        e.handle(super::Command::StartCountdown { label: "Service".into(), seconds: 300, show_on_audience: true }, now);
        let c = e.layers().countdown.clone().unwrap();
        assert!(c.ends_at_unix_ms > super::unix_ms() + 299_000);
        e.handle(super::Command::GoSlide { presentation: 1, slide: 1 }, now);
        let ev = e.handle(super::Command::ClearAll, now);
        assert!(ev.iter().any(|x| matches!(x, super::Event::SlideCleared)));
        assert_eq!(e.layers(), &super::Layers::default());
        assert_eq!(e.live_slide(), None);
    }

    use super::*;
    use crate::demo::demo_show;

    #[test]
    fn slide_fires_cue_and_mixer() {
        let mut e = Engine::new(demo_show());
        let now = Instant::now();
        // Demo: presentation 1, slide 1 has a lighting cue + mixer scene trigger.
        let ev = e.handle(Command::GoSlide { presentation: 1, slide: 1 }, now);
        assert!(ev.iter().any(|x| matches!(x, Event::SlideLive { .. })));
        assert!(ev.iter().any(|x| matches!(x, Event::CueFired { .. })));
        assert!(ev.iter().any(|x| matches!(x, Event::MixerOut { .. })));
        // After the fade the walk-in cue is on stage.
        let f = e.frame(now + Duration::from_secs(10));
        assert!(f.universes[&1].iter().any(|v| *v > 0));
    }

    #[test]
    fn text_to_programmer_to_cue() {
        let mut e = Engine::new(demo_show());
        let now = Instant::now();
        let ev = e.handle(Command::ApplyText { text: "back wall blue, movers gobo 3 location centre stage".into() }, now);
        let built = ev.iter().find_map(|x| match x {
            Event::SceneBuilt { applied, issues, .. } => Some((applied.clone(), issues.clone())),
            _ => None,
        });
        let (applied, issues) = built.unwrap();
        assert_eq!(applied.len(), 2);
        assert!(issues.is_empty(), "{issues:?}");
        let n = e.show.cues.len();
        e.handle(Command::RecordCue { name: "Blue wash".into(), fade_ms: 2000 }, now);
        assert_eq!(e.show.cues.len(), n + 1);
        assert!(e.programmer.is_empty());
    }

    #[test]
    fn blackout_zeroes_intensity() {
        let mut e = Engine::new(demo_show());
        let now = Instant::now();
        e.handle(Command::ApplyText { text: "everything white at full".into() }, now);
        assert!(e.frame(now).universes[&1].iter().any(|v| *v > 0));
        e.handle(Command::Blackout { on: true }, now);
        let f = e.frame(now);
        let show = &e.show;
        for fx in &show.fixtures {
            let p = show.profile(&fx.profile_id).unwrap();
            if let Some(o) = p.offset(&crate::lighting::Attr::Dimmer) {
                assert_eq!(f.get(fx.universe, fx.address + o), 0);
            }
        }
    }
}
