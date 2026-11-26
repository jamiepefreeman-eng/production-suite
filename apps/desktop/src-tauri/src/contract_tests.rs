//! Rust <-> TypeScript contract check.
//!
//! The types in `src/shared/types.ts` are mirrored by hand (CLAUDE.md rule 4).
//! This test serialises a real sample of every type that crosses the bridge and
//! writes it to `src/shared/contract.generated.ts`, each sample annotated with
//! its TypeScript type. `npm run typecheck` then fails if a field was renamed,
//! added or removed on one side only.
//!
//!     cargo test -p production-suite      # regenerates the file
//!     cd apps/desktop && npm run typecheck

use crate::audio::AudioDevice;
use crate::mixer_link::MixerStatus;
use crate::usb_dmx::SerialPortInfo;
use crate::viz_input::VizSource;
use crate::windows::MonitorInfo;
use serde::Serialize;
use suite_core::ai::intent::{Action, Intent, ParseOutput};
use suite_core::engine::{Command, Countdown, Event, GroupLevel, Layers, LogLevel};
use suite_core::lighting::effects::{Effect, EffectKind};
use suite_core::midi::{MidiControl, MidiControlKind, MidiMessage};
use suite_core::presenter::{
    ClearLayer, ElementKind, MediaAnalysis, MediaItem, MediaKind, MediaPlaylist, SlideElement, SlideGroup, SlideTrigger, TextAlign, TextPosition, TextStyle, Theme,
};
use suite_core::show::{Scenery, SceneryKind};
use suite_core::lighting::{FixtureState, FixtureVisual, Look, Rgb};
use suite_core::mixer::connection::MixerFeedback;
use suite_core::mixer::{ChannelParam, ChannelUpdate, EqType, MixerCommand, MixerConfig, MixerKind};

struct Out(String);

impl Out {
    fn add<V: Serialize>(&mut self, name: &str, ty: &str, value: &V) {
        let json = serde_json::to_string_pretty(value).expect("serialise");
        self.0.push_str(&format!("export const {name}: {ty} = {json};\n\n"));
    }
}

#[test]
fn write_typescript_contract() {
    let mut show = suite_core::demo::demo_show();
    // Exercise every variant the demo doesn't use.
    for (i, (kind, path)) in [(MediaKind::Image, "/m/bg.jpg"), (MediaKind::Video, "/m/loop.mp4"), (MediaKind::Audio, "/m/walkin.mp3")]
        .into_iter()
        .enumerate()
    {
        show.media.push(MediaItem { id: i as u32 + 1, name: path.into(), path: path.into(), kind, analysis: None });
        if i == 0 {
            show.media[0].analysis = Some(MediaAnalysis {
                colors: vec!["#ff8800".into(), "#221100".into()],
                color_names: vec!["orange".into()],
                brightness: 0.6,
                saturation: 0.8,
                motion: 0.3,
                duration: 12.5,
                tags: vec!["warm".into(), "fast".into()],
            });
        }
    }
    for (i, position) in [TextPosition::Top, TextPosition::Bottom].into_iter().enumerate() {
        show.themes.push(Theme { name: format!("t{i}"), position, background_media: Some(1), ..Theme::default() });
    }
    for (i, kind) in [
        SceneryKind::Drape,
        SceneryKind::Riser,
        SceneryKind::StageDeck,
        SceneryKind::Truss,
        SceneryKind::Screen,
        SceneryKind::Person,
        SceneryKind::DrumKit,
        SceneryKind::Keyboard,
        SceneryKind::Guitarist,
        SceneryKind::MicStand,
        SceneryKind::Speaker,
        SceneryKind::Wedge,
        SceneryKind::Model,
    ]
    .into_iter()
    .enumerate()
    {
        show.scenery.push(Scenery { id: 10 + i as u32, kind, ..Scenery::default() });
    }
    show.media.push(MediaItem { id: 4, name: "Camera".into(), path: "Blackmagic UltraStudio".into(), kind: MediaKind::Input, analysis: None });
    for (i, kind) in EffectKind::ALL.into_iter().enumerate() {
        show.effects.push(Effect { id: 100 + i as u32, kind, ..Effect::default() });
    }
    show.show_page.items[0].midi = Some(MidiControl { kind: MidiControlKind::Note, channel: 1, number: 36 });
    show.show_page.items[1].midi = Some(MidiControl { kind: MidiControlKind::Cc, channel: 1, number: 7 });
    show.show_page.items[1].label = "Walk-in".into();
    show.show_page.items[1].color = "#ff8800".into();
    show.lyric_follow.mode = suite_core::presenter::follow::FollowMode::Auto;
    show.libraries = vec!["Christmas".into()];
    show.ccli = suite_core::show::CcliSettings { license: "1234567".into(), footer: suite_core::show::CcliFooter::First };
    show.presentations[2].authors = "John Newton".into();
    show.presentations[2].copyright = "Public Domain".into();
    {
        use suite_core::show::{MidiAction as A, MidiTrigger};
        let pc = Some(MidiControl { kind: MidiControlKind::Program, channel: 16, number: 0 });
        let actions = vec![
            A::NextSlide,
            A::PreviousSlide,
            A::GoGroup { group: "Chorus".into() },
            A::GoSlideIndex { index: 1 },
            A::GoServiceItem { index: 2 },
            A::GoSlide { presentation: 2, slide: 1 },
            A::Trigger { trigger: SlideTrigger::LightingCue { cue: 1 } },
        ];
        show.midi_triggers = actions
            .into_iter()
            .enumerate()
            .map(|(i, action)| MidiTrigger { id: i as u32 + 1, name: format!("t{i}"), control: if i == 0 { None } else { pc }, number_is_index: i == 4, action })
            .collect();
    }
    for footer in [suite_core::show::CcliFooter::Last, suite_core::show::CcliFooter::All, suite_core::show::CcliFooter::Off] {
        let _ = footer; // every variant appears in ccliFooters below
    }
    show.presentations[1].library = "Christmas".into();
    show.media_playlists.push(MediaPlaylist { name: "Backgrounds".into(), items: vec![1, 2] });
    show.presentations[1].groups.push(SlideGroup { name: "Vamp".into(), color: "#f97316".into() });
    show.presentations[1].arrangement = Some("Sunday".into());
    let triggers = vec![
        SlideTrigger::Media { media: Some(1) },
        SlideTrigger::Media { media: None },
        SlideTrigger::Audio { audio: Some(3), looped: true },
        SlideTrigger::Prop { prop: 1, on: true },
        SlideTrigger::Macro { id: 1 },
        SlideTrigger::Clear { layer: ClearLayer::All },
        SlideTrigger::Clear { layer: ClearLayer::Slide },
        SlideTrigger::Clear { layer: ClearLayer::Media },
        SlideTrigger::Clear { layer: ClearLayer::Audio },
        SlideTrigger::Clear { layer: ClearLayer::Props },
        SlideTrigger::Clear { layer: ClearLayer::Timer },
        SlideTrigger::Clear { layer: ClearLayer::Lights },
    ];
    show.presentations[1].slides[0].triggers.extend(triggers.clone());
    // Per-slide formatting and elements (every kind / alignment once).
    show.presentations[1].slides[0].style = TextStyle {
        font: Some("Georgia".into()),
        size: Some(1.2),
        color: Some("#ffcc00".into()),
        bold: Some(false),
        italic: Some(true),
        uppercase: Some(true),
        shadow: Some(false),
        position: Some(TextPosition::Bottom),
        align: Some(TextAlign::Left),
    };
    show.presentations[1].slides[1].style = TextStyle { align: Some(TextAlign::Right), ..Default::default() };
    show.presentations[1].slides[0].elements = vec![
        SlideElement { id: 1, kind: ElementKind::Text, text: "Welcome".into(), ..Default::default() },
        SlideElement { id: 2, kind: ElementKind::Media, media: Some(1), ..Default::default() },
        SlideElement { id: 3, kind: ElementKind::Shape, background: "#000000aa".into(), radius: 10.0, ..Default::default() },
    ];
    let layers = Layers {
        media: Some(2),
        audio: Some(3),
        audio_loop: true,
        countdown: Some(Countdown { label: "Service starts".into(), ends_at_unix_ms: 1_800_000_000_000, show_on_audience: true }),
        props: vec![1, 2],
    };
    let mut look = Look::default();
    let state = FixtureState {
        intensity: Some(0.8),
        color: Some(Rgb { r: 1.0, g: 0.5, b: 0.0 }),
        gobo: Some(2),
        pan: Some(0.5),
        tilt: Some(0.25),
    };
    look.fixtures.insert(1, state.clone());
    let intents = vec![Intent {
        target: "movers".into(),
        actions: vec![
            Action::Intensity(50.0),
            Action::Color("blue".into()),
            Action::Gobo(3),
            Action::Position("Centre Stage".into()),
            Action::Off,
        ],
    }];
    let mixer_cmds = vec![
        MixerCommand::Fader { channel: 1, level: 0.75 },
        MixerCommand::Mute { channel: 2, muted: true },
        MixerCommand::MainFader { level: 0.5 },
        MixerCommand::RecallScene { scene: 3 },
        MixerCommand::QueryChannel { channel: 4 },
    ];
    let channel_params = vec![
        ChannelParam::Fader { level: 0.75 },
        ChannelParam::Mute { muted: true },
        ChannelParam::Pan { pan: -0.25 },
        ChannelParam::Name { name: "Pastor".into() },
        ChannelParam::HpfOn { on: true },
        ChannelParam::HpfFreq { hz: 80.0 },
        ChannelParam::EqOn { on: true },
        ChannelParam::EqType { band: 1, kind: EqType::LowShelf },
        ChannelParam::EqType { band: 2, kind: EqType::Peq },
        ChannelParam::EqType { band: 2, kind: EqType::Veq },
        ChannelParam::EqType { band: 2, kind: EqType::LowCut },
        ChannelParam::EqType { band: 4, kind: EqType::HighShelf },
        ChannelParam::EqType { band: 4, kind: EqType::HighCut },
        ChannelParam::EqFreq { band: 2, hz: 400.0 },
        ChannelParam::EqGain { band: 2, db: -3.0 },
        ChannelParam::EqQ { band: 2, q: 2.0 },
        ChannelParam::GateOn { on: true },
        ChannelParam::GateThreshold { db: -50.0 },
        ChannelParam::GateRange { db: 40.0 },
        ChannelParam::GateAttack { ms: 1.0 },
        ChannelParam::GateHold { ms: 50.0 },
        ChannelParam::GateRelease { ms: 200.0 },
        ChannelParam::CompOn { on: true },
        ChannelParam::CompThreshold { db: -20.0 },
        ChannelParam::CompRatio { ratio: 3.0 },
        ChannelParam::CompKnee { db: 2.0 },
        ChannelParam::CompMakeup { db: 4.0 },
        ChannelParam::CompAttack { ms: 10.0 },
        ChannelParam::CompHold { ms: 1.0 },
        ChannelParam::CompRelease { ms: 150.0 },
    ];

    let commands = vec![
        Command::GoSlide { presentation: 1, slide: 2 },
        Command::ClearSlide,
        Command::SetMedia { media: Some(2) },
        Command::SetMedia { media: None },
        Command::PlayAudio { audio: Some(3), looped: true },
        Command::StartCountdown { label: "Service".into(), seconds: 300, show_on_audience: true },
        Command::ClearCountdown,
        Command::ClearAll,
        Command::SetProp { prop: 1, on: true },
        Command::ClearProps,
        Command::RunMacro { id: 1 },
        Command::GoCue { cue: 1 },
        Command::ReleaseCue,
        Command::Blackout { on: true },
        Command::GrandMaster { level: 0.9 },
        Command::ClearProgrammer,
        Command::ApplyText { text: "front wash blue".into() },
        Command::ApplyIntents { intents: intents.clone(), unknown: vec!["sparkles".into()], source: Some("x".into()) },
        Command::SetFixtureState { fixtures: vec![1, 2], state: state.clone() },
        Command::MergeProgrammer { look: look.clone() },
        Command::SetEffect { effect: 1, on: true },
        Command::GroupMaster { group: "Back Wall".into(), level: 0.5 },
        Command::TriggerShowItem { item: 1, value: 1.0 },
        Command::MidiInput { message: MidiMessage::NoteOn { channel: 1, note: 36, velocity: 100 } },
        Command::MidiInput { message: MidiMessage::NoteOff { channel: 1, note: 36 } },
        Command::MidiInput { message: MidiMessage::ControlChange { channel: 2, controller: 7, value: 64 } },
        Command::MidiInput { message: MidiMessage::ProgramChange { channel: 16, program: 3 } },
        Command::RecordCue { name: "Walk-in".into(), fade_ms: 2000 },
        Command::DeleteCue { cue: 1 },
        Command::RecordPosition { name: "Pulpit".into() },
        Command::MoveFixture { fixture: 1, position: [0.0, 5.0, -1.0], rotation: [180.0, 0.0, 0.0] },
        Command::Mixer { command: mixer_cmds[0].clone() },
        Command::LoadShow { show: show.clone() },
        Command::ReplaceShow { show: show.clone() },
    ];
    let events = vec![
        Event::ShowChanged,
        Event::LayersChanged { layers: layers.clone() },
        Event::LayersChanged { layers: Layers::default() },
        Event::SlideLive { presentation: 1, slide: 2, title: "Song".into(), label: "Verse 1".into(), text: "…".into() },
        Event::SlideCleared,
        Event::CueFired { cue: 1, name: "Walk-in".into() },
        Event::CueReleased,
        Event::ProgrammerChanged { look: look.clone() },
        Event::SceneBuilt { applied: vec!["a".into()], issues: vec!["b".into()], unknown: vec!["c".into()] },
        Event::BlackoutChanged { on: false },
        Event::EffectsChanged { active: vec![1, 2] },
        Event::MastersChanged { grand_master: 0.8, groups: vec![GroupLevel { group: "Back Wall".into(), level: 0.5 }] },
        Event::MidiReceived { message: MidiMessage::ControlChange { channel: 1, controller: 1, value: 0 } },
        Event::ToggleMatchBackground,
        Event::MixerOut { command: mixer_cmds[1].clone() },
        Event::Log { level: LogLevel::Info, message: "hi".into() },
        Event::Log { level: LogLevel::Warn, message: "careful".into() },
    ];

    let mut o = Out(String::from(
        "// GENERATED by `cargo test -p production-suite` (src-tauri/src/contract_tests.rs).\n\
         // Do not edit. It exists so `npm run typecheck` proves types.ts matches the Rust JSON.\n\
         /* eslint-disable */\n\
         import type * as T from \"./types\";\n\n",
    ));
    o.add("show", "T.Show", &show);
    o.add("commands", "T.Command[]", &commands);
    o.add("events", "T.EngineEvent[]", &events);
    o.add("mixerCommands", "T.MixerCommand[]", &mixer_cmds);
    o.add("channelParams", "T.ChannelParam[]", &channel_params);
    o.add(
        "channelCommands",
        "T.MixerCommand[]",
        &channel_params.iter().map(|p| MixerCommand::Channel { channel: 1, param: p.clone() }).collect::<Vec<_>>(),
    );
    o.add("parseOutput", "T.ParseOutput", &ParseOutput { intents, unknown: vec![] });
    o.add(
        "engineStatus",
        "T.EngineStatus",
        &crate::commands::EngineStatus {
            active_cue: Some(1),
            live_slide: Some((1, 2)),
            programmer: look,
            layers,
            show_path: Some("/tmp/show.json".into()),
            active_effects: vec![1],
            grand_master: 1.0,
            group_levels: vec![GroupLevel { group: "Front Wash".into(), level: 0.7 }],
            blackout: false,
        },
    );
    let follow_input = crate::lyric_follow::FollowInput { device: "X32".into(), channel: 3, model: "/m/ggml-base.en.bin".into(), gate_db: -45.0 };
    o.add(
        "followStatus",
        "T.FollowStatus",
        &crate::lyric_follow::FollowStatus {
            running: true,
            mode: Some(suite_core::presenter::follow::FollowMode::Assist),
            input: Some(follow_input.clone()),
            error: Some("x".into()),
            level_db: -30.0,
            voice: true,
            heard: "amazing grace".into(),
            confidence: 0.8,
            live: Some((1, 2)),
            next: Some((1, 3)),
            sung_word: Some(4),
            trigger_word: Some(9),
            in_previous: false,
            ready: true,
            blocked: Some("held".into()),
            reason: Some("near the end".into()),
            latency_ms: 900,
        },
    );
    o.add("followStatusIdle", "T.FollowStatus", &crate::lyric_follow::FollowStatus::default());
    o.add("followInput", "T.FollowInput", &follow_input);
    o.add(
        "speechModels",
        "T.SpeechModel[]",
        &vec![crate::lyric_follow::ModelInfo { name: "base.en".into(), size_mb: 142, note: "x".into(), path: "/m/ggml-base.en.bin".into(), downloaded: true }],
    );
    o.add("modelProgress", "T.ModelProgress", &crate::lyric_follow::Progress { name: "base.en".into(), downloaded: 10, total: Some(100) });
    o.add("modelProgressUnknown", "T.ModelProgress", &crate::lyric_follow::Progress { name: "base.en".into(), downloaded: 10, total: None });
    o.add(
        "ccliFooters",
        "T.CcliFooter[]",
        &vec![suite_core::show::CcliFooter::First, suite_core::show::CcliFooter::Last, suite_core::show::CcliFooter::All, suite_core::show::CcliFooter::Off],
    );
    o.add(
        "importedSongs",
        "T.ImportedSong[]",
        &vec![
            crate::songs::ImportedSong { path: "/x/a.txt".into(), presentation: Some(suite_core::presenter::parse_lyrics(1, "A", "x", 2)), error: None },
            crate::songs::ImportedSong { path: "/x/b.txt".into(), presentation: None, error: Some("no lyrics".into()) },
        ],
    );
    o.add(
        "ccliUsage",
        "T.UsageEntry[]",
        &vec![crate::songs::UsageEntry { at: 1, title: "Way Maker".into(), ccli: Some("7115744".into()), authors: "Sinach".into(), copyright: "©".into(), show: "Sunday".into() }],
    );
    o.add("pcoStatus", "T.PcoStatus", &crate::pco::PcoStatus { signed_in: true, app_id: "abc".into() });
    o.add("pcoServiceTypes", "T.PcoServiceType[]", &vec![crate::pco::PcoServiceType { id: "1".into(), name: "Sunday".into() }]);
    o.add("pcoPlans", "T.PcoPlan[]", &vec![crate::pco::PcoPlan { id: "2".into(), title: "Advent 1".into(), dates: "Dec 7".into(), series: "Advent".into() }]);
    {
        use crate::pco::{PcoItem, PcoItemKind as K};
        let item = |kind: K| PcoItem {
            kind,
            title: "x".into(),
            key: "G".into(),
            ccli: Some("1".into()),
            authors: "a".into(),
            copyright: "c".into(),
            arrangement: "Default".into(),
            lyrics: "Verse 1\nx".into(),
            sequence: vec!["Verse 1".into()],
        };
        o.add(
            "pcoPlan",
            "T.PcoPlanImport",
            &crate::pco::PcoPlanImport { title: "Advent".into(), dates: "Dec 7".into(), items: vec![item(K::Song), item(K::Header), item(K::Item), item(K::Media)] },
        );
    }
    o.add(
        "recentShows",
        "T.RecentShow[]",
        &vec![crate::commands::RecentShowInfo { path: "/Shows/Sunday.json".into(), name: "COR".into(), used_at: 1_800_000_000_000, exists: true, current: true }],
    );
    o.add(
        "midiStatus",
        "T.MidiStatus",
        &crate::midi_link::MidiStatus { available: vec!["APC mini".into()], connected: vec!["APC mini".into()], errors: vec!["x".into()] },
    );
    o.add(
        "vizFrame",
        "T.VizFrame",
        &crate::dmx_out::VizFrame {
            source: "internal",
            fixtures: vec![FixtureVisual { id: 1, intensity: 1.0, color: Rgb { r: 0.1, g: 0.2, b: 0.3 }, pan: 0.5, tilt: 0.5, gobo: 0 }],
        },
    );
    o.add(
        "vizSources",
        "T.VizSource[]",
        &vec![VizSource::Internal, VizSource::ArtNet, VizSource::Sacn { universes: 2 }],
    );
    let cfg = MixerConfig { kind: MixerKind::XAir, ip: "192.168.1.20".into(), midi_channel: 1 };
    o.add(
        "mixerStatus",
        "T.MixerStatus",
        &MixerStatus {
            connected: true,
            config: Some(cfg),
            input_channels: 16,
            supports_processing: true,
            kinds: MixerKind::ALL.iter().map(|k| (*k, k.label().to_string())).collect(),
        },
    );
    o.add("mixerFeedback", "T.MixerFeedback[]", &vec![
            MixerFeedback {
                address: "/ch/01/mix/on".into(),
                value: Some(1.0),
                update: Some(ChannelUpdate { channel: 1, param: ChannelParam::Mute { muted: false } }),
            },
            MixerFeedback { address: "/xinfo".into(), value: None, update: None },
        ]);
    o.add(
        "audioDevices",
        "T.AudioDevice[]",
        &vec![AudioDevice {
            host: "CoreAudio".into(),
            name: "X-USB".into(),
            input_channels: 32,
            output_channels: 32,
            sample_rate: Some(48000),
            is_default_input: false,
            is_default_output: true,
            matches_mixer: Some("X32/M32".into()),
        }],
    );
    o.add(
        "serialPorts",
        "T.SerialPortInfo[]",
        &vec![SerialPortInfo {
            name: "COM3".into(),
            vid: Some(0x0403),
            pid: Some(0x6001),
            product: Some("DMX USB PRO".into()),
            serial: None,
            likely_dmx: true,
        }],
    );
    o.add(
        "monitors",
        "T.MonitorInfo[]",
        &vec![MonitorInfo { index: 0, name: Some("Built-in".into()), width: 2560, height: 1600, x: 0, y: 0, scale: 2.0 }],
    );
    o.add(
        "sceneResult",
        "T.SceneResult",
        &crate::ai_client::SceneResult { engine: "offline".into(), parsed: ParseOutput::default() },
    );
    o.add(
        "mediaRanking",
        "T.MediaRanking",
        &crate::ai_client::MediaRanking {
            picks: vec![crate::ai_client::MediaPick { id: 1, reason: "warm orange with movement".into() }],
            target: Some("Amazing Grace".into()),
        },
    );
    o.add("mediaRankingNoTarget", "T.MediaRanking", &crate::ai_client::MediaRanking { picks: vec![], target: None });
    o.add(
        "mediaSummaries",
        "T.MediaSummary[]",
        &vec![crate::ai_client::MediaSummary { id: 1, name: "Sunset".into(), kind: "video".into(), description: "orange".into() }],
    );
    o.add(
        "aiStatus",
        "T.AiStatus",
        &crate::ai_client::AiStatus { has_api_key: false, model: crate::ai_client::DEFAULT_MODEL.into() },
    );

    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/shared/contract.generated.ts");
    std::fs::write(&path, o.0).expect("write contract.generated.ts");
}

/// Everything the UI sends must make it back into Rust. Tauri reads command
/// arguments from a borrowed `serde_json::Value`, which — unlike `from_str` —
/// does not turn the string map keys `"1"` back into numbers by itself. That
/// once made every `replace_show` (adding a song, editing triggers) fail.
#[test]
fn commands_round_trip_the_way_tauri_reads_them() {
    use serde::Deserialize;
    let show = suite_core::demo::demo_show();
    assert!(show.cues.iter().any(|c| !c.look.fixtures.is_empty()), "demo needs cue looks to exercise map keys");
    let mut look = Look::default();
    look.fixtures.insert(7, FixtureState { intensity: Some(0.5), ..Default::default() });
    let commands = vec![
        Command::ReplaceShow { show: show.clone() },
        Command::LoadShow { show },
        Command::SetFixtureState { fixtures: vec![7], state: look.fixtures[&7].clone() },
        Command::Mixer { command: MixerCommand::Channel { channel: 3, param: ChannelParam::EqType { band: 2, kind: EqType::Veq } } },
        Command::Mixer { command: MixerCommand::Channel { channel: 3, param: ChannelParam::Name { name: "Pastor".into() } } },
        Command::Mixer { command: MixerCommand::QueryChannel { channel: 3 } },
    ];
    for cmd in commands {
        let value = serde_json::to_value(&cmd).unwrap();
        let back = Command::deserialize(&value).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(back, cmd);
        let back2: Command = serde_json::from_value(value).unwrap();
        assert_eq!(back2, cmd);
    }
    let v = serde_json::to_value(&Event::ProgrammerChanged { look: look.clone() }).unwrap();
    assert_eq!(Event::deserialize(&v).unwrap(), Event::ProgrammerChanged { look });
}

/// Show files saved by older versions (no themes / media / scenery yet) must still open.
#[test]
fn old_show_files_still_open() {
    let mut v = serde_json::to_value(suite_core::demo::demo_show()).unwrap();
    let obj = v.as_object_mut().unwrap();
    for k in ["themes", "media", "scenery"] {
        obj.remove(k);
    }
    let show: suite_core::show::Show = serde_json::from_value(v).expect("v0.2 show file loads");
    assert!(show.themes.is_empty() && show.media.is_empty() && show.scenery.is_empty());
    // Slides from before per-slide formatting/elements.
    let mut v = serde_json::to_value(suite_core::demo::demo_show()).unwrap();
    for p in v["presentations"].as_array_mut().unwrap() {
        for s in p["slides"].as_array_mut().unwrap() {
            let s = s.as_object_mut().unwrap();
            s.remove("style");
            s.remove("elements");
        }
    }
    let old: suite_core::show::Show = serde_json::from_value(v).expect("v0.7 slides load");
    assert!(old.presentations.iter().flat_map(|p| &p.slides).all(|s| s.elements.is_empty()));
    // Presentations naming a theme that doesn't exist fall back to the built-in default.
    assert_eq!(show.theme_for(&show.presentations[0]).name, "Default");
}
