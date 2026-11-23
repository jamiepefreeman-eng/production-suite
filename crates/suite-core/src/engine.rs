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
use crate::presenter::SlideTrigger;
use crate::show::Show;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "type", rename_all = "snake_case"))]
pub enum Command {
    // ── Presenter
    GoSlide { presentation: u32, slide: u32 },
    ClearSlide,
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
            }
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
