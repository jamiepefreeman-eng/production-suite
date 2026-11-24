//! Demo show built around the current rig (fixture types and modes from the
//! Lightkey patch). Addresses are laid out sequentially on universe 1 —
//! replace them with the real patch. Profiles flagged `needs_verification`
//! were entered without the manual and must be checked.

use crate::dmx::DmxOutputConfig;
use crate::lighting::*;
use crate::presenter::{parse_lyrics, Presentation, PresentationKind, Slide, SlideTrigger};
use crate::mixer::MixerCommand;
use crate::presenter::{TextPosition, Theme};
use crate::show::{Scenery, SceneryKind, Show, StageConfig};

fn ch(attr: Attr) -> ChannelDef {
    ChannelDef { attr, default: 0 }
}

fn ch_default(attr: Attr, default: u8) -> ChannelDef {
    ChannelDef { attr, default }
}

pub fn profiles() -> Vec<FixtureProfile> {
    vec![
        FixtureProfile {
            id: "adj-cob-cannon-wash-4ch".into(),
            manufacturer: "American DJ".into(),
            model: "COB Cannon Wash".into(),
            mode: "Mode 2 (4ch)".into(),
            kind: FixtureKind::Wash,
            // VERIFY: assumed R, G, B, Amber for the 4-channel mode.
            channels: vec![ch(Attr::Red), ch(Attr::Green), ch(Attr::Blue), ch(Attr::Amber)],
            gobo_slots: vec![],
            color_wheel: vec![],
            pan_range: 0.0,
            tilt_range: 0.0,
            beam_angle: 40.0,
            needs_verification: true,
        },
        FixtureProfile {
            id: "mdac-curtain-8ch".into(),
            manufacturer: "MDAC".into(),
            model: "Curtain".into(),
            mode: "Mode 1 (8ch)".into(),
            // Floor puck up-lighting the back wall (no panel of its own).
            kind: FixtureKind::Puck,
            // From the Lightkey user profile: dimmer, R, G, B, ch5-8 unassigned.
            channels: vec![
                ch(Attr::Dimmer),
                ch(Attr::Red),
                ch(Attr::Green),
                ch(Attr::Blue),
                ch(Attr::Unused),
                ch(Attr::Unused),
                ch(Attr::Unused),
                ch(Attr::Unused),
            ],
            gobo_slots: vec![],
            color_wheel: vec![],
            pan_range: 0.0,
            tilt_range: 0.0,
            beam_angle: 40.0,
            needs_verification: false,
        },
        FixtureProfile {
            id: "mdac-sidewall-3ch".into(),
            manufacturer: "MDAC".into(),
            model: "Sidewall".into(),
            mode: "Mode 1 (3ch)".into(),
            kind: FixtureKind::Strip,
            channels: vec![ch(Attr::Red), ch(Attr::Green), ch(Attr::Blue)],
            gobo_slots: vec![],
            color_wheel: vec![],
            pan_range: 0.0,
            tilt_range: 0.0,
            beam_angle: 120.0,
            needs_verification: false,
        },
        FixtureProfile {
            id: "chauvet-intimidator-spot-250-13ch".into(),
            manufacturer: "Chauvet DJ".into(),
            model: "Intimidator Spot LED 250".into(),
            mode: "13ch".into(),
            kind: FixtureKind::MovingSpot,
            // VERIFY: channel order, wheel slot values and shutter-open value.
            channels: vec![
                ch_default(Attr::Pan, 128),
                ch(Attr::PanFine),
                ch_default(Attr::Tilt, 128),
                ch(Attr::TiltFine),
                ch(Attr::Speed),
                ch(Attr::ColorWheel),
                ch(Attr::Gobo),
                ch(Attr::Dimmer),
                ch_default(Attr::Shutter, 255),
                ch(Attr::Control),
                ch(Attr::Control),
                ch(Attr::Control),
                ch(Attr::Control),
            ],
            gobo_slots: vec![0, 10, 20, 30, 40, 50, 60, 70],
            color_wheel: vec![
                ColorSlot { name: "White".into(), dmx: 0, rgb: Rgb::new(1.0, 1.0, 1.0) },
                ColorSlot { name: "Red".into(), dmx: 10, rgb: Rgb::new(1.0, 0.0, 0.0) },
                ColorSlot { name: "Orange".into(), dmx: 20, rgb: Rgb::new(1.0, 0.45, 0.0) },
                ColorSlot { name: "Yellow".into(), dmx: 30, rgb: Rgb::new(1.0, 0.9, 0.0) },
                ColorSlot { name: "Green".into(), dmx: 40, rgb: Rgb::new(0.0, 1.0, 0.0) },
                ColorSlot { name: "Blue".into(), dmx: 50, rgb: Rgb::new(0.0, 0.0, 1.0) },
                ColorSlot { name: "Light Blue".into(), dmx: 60, rgb: Rgb::new(0.4, 0.7, 1.0) },
                ColorSlot { name: "Magenta".into(), dmx: 70, rgb: Rgb::new(1.0, 0.0, 1.0) },
            ],
            pan_range: 540.0,
            tilt_range: 270.0,
            beam_angle: 13.0,
            needs_verification: true,
        },
    ]
}

pub fn demo_show() -> Show {
    let mut fixtures = Vec::new();
    let mut next_id = 1u32;
    let mut addr = 1u16;
    let mut add = |name: String, profile: &str, footprint: u16, pos: [f32; 3], rot: [f32; 3], fixtures: &mut Vec<Fixture>| {
        fixtures.push(Fixture {
            id: next_id,
            name,
            profile_id: profile.into(),
            universe: 1,
            address: addr,
            position: pos,
            rotation: rot,
        });
        next_id += 1;
        addr += footprint;
        next_id - 1
    };

    // Front truss: 4 COB cannons aimed at the stage.
    let fronts: Vec<u32> = (0..4)
        .map(|i| {
            let x = -4.5 + i as f32 * 3.0;
            add(format!("Front {}", i + 1), "adj-cob-cannon-wash-4ch", 4, [x, 5.0, 5.0], [-135.0, 0.0, 0.0], &mut fixtures)
        })
        .collect();
    // Upstage: 13 MDAC curtain pucks on the floor, tilted back to wash up the back wall.
    let curtains: Vec<u32> = (0..13)
        .map(|i| {
            let x = -6.0 + i as f32 * 1.0;
            add(format!("Curtain {}", i + 1), "mdac-curtain-8ch", 8, [x, 0.05, -3.6], [-12.0, 0.0, 0.0], &mut fixtures)
        })
        .collect();
    // Side walls.
    let sides: Vec<u32> = [("Sidewall L", -6.5f32, 90.0f32), ("Sidewall R", 6.5, -90.0)]
        .into_iter()
        .map(|(n, x, ry)| add(n.into(), "mdac-sidewall-3ch", 3, [x, 2.0, 0.0], [0.0, ry, 0.0], &mut fixtures))
        .collect();
    // Mid truss: 4 Intimidator spots, hung.
    let movers: Vec<u32> = (0..4)
        .map(|i| {
            let x = -4.5 + i as f32 * 3.0;
            add(format!("Mover {}", i + 1), "chauvet-intimidator-spot-250-13ch", 13, [x, 6.0, 0.0], [180.0, 0.0, 0.0], &mut fixtures)
        })
        .collect();

    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    let groups = vec![
        Group { name: "Back Wall".into(), aliases: s(&["curtains", "curtain", "backdrop", "upstage wall", "back"]), fixtures: curtains.clone() },
        Group { name: "Front Wash".into(), aliases: s(&["front spots", "front lights", "fronts", "front", "cannons"]), fixtures: fronts.clone() },
        Group { name: "Side Walls".into(), aliases: s(&["sidewalls", "sides", "side wall", "side lights"]), fixtures: sides.clone() },
        Group { name: "Movers".into(), aliases: s(&["moving heads", "moving lights", "spots", "intimidators", "heads"]), fixtures: movers.clone() },
    ];

    // Rough focus points — re-record them during a focus session.
    let preset = |name: &str, aliases: &[&str], pans: [f32; 4], tilt: f32| PositionPreset {
        name: name.into(),
        aliases: s(aliases),
        values: movers.iter().zip(pans).map(|(id, pan)| PanTilt { fixture: *id, pan, tilt }).collect(),
    };
    let positions = vec![
        preset("Centre Stage", &["center stage", "centre", "middle", "cs"], [0.53, 0.51, 0.49, 0.47], 0.42),
        preset("Pulpit", &["podium", "lectern", "speaker", "downstage centre"], [0.55, 0.52, 0.48, 0.45], 0.36),
        preset("Audience", &["crowd", "congregation", "house"], [0.5, 0.5, 0.5, 0.5], 0.2),
        preset("Back Wall", &["upstage", "wall"], [0.5, 0.5, 0.5, 0.5], 0.62),
    ];

    let look = |parts: &[(&Vec<u32>, f32, Rgb)]| {
        let mut l = Look::default();
        for (ids, i, c) in parts {
            for id in *ids {
                let st = l.state_mut(*id);
                st.intensity = Some(*i);
                st.color = Some(*c);
            }
        }
        l
    };
    let blue = Rgb::new(0.0, 0.0, 1.0);
    let warm = Rgb::new(1.0, 0.78, 0.5);
    let purple = Rgb::new(0.55, 0.0, 1.0);
    let mut worship = look(&[(&curtains, 1.0, purple), (&sides, 0.8, blue), (&fronts, 0.85, warm), (&movers, 1.0, Rgb::new(1.0, 1.0, 1.0))]);
    for (id, v) in movers.iter().zip(&positions[0].values) {
        let st = worship.state_mut(*id);
        st.gobo = Some(2);
        st.pan = Some(v.pan);
        st.tilt = Some(v.tilt);
    }
    let cues = vec![
        Cue { id: 1, name: "Walk-in".into(), look: look(&[(&curtains, 0.6, blue), (&sides, 0.5, blue), (&fronts, 0.4, warm)]), fade_ms: 3000, source_text: None },
        Cue { id: 2, name: "Worship — Full".into(), look: worship, fade_ms: 2000, source_text: None },
        Cue { id: 3, name: "Sermon".into(), look: look(&[(&fronts, 0.9, warm), (&curtains, 0.2, blue), (&sides, 0.2, blue)]), fade_ms: 4000, source_text: None },
    ];

    // Presenter content (public-domain text only).
    let welcome = Presentation {
        id: 1,
        title: "Welcome".into(),
        kind: PresentationKind::Announcement,
        ccli: None,
        theme: "Default".into(),
        slides: vec![
            Slide {
                id: 1,
                label: "Welcome".into(),
                text: "Welcome!\nWe're glad you're here".into(),
                triggers: vec![
                    SlideTrigger::LightingCue { cue: 1 },
                    SlideTrigger::Mixer { command: MixerCommand::RecallScene { scene: 1 } },
                ],
            },
            Slide { id: 2, label: "Connect".into(), text: "New here?\nVisit the welcome desk".into(), triggers: vec![] },
        ],
    };
    let mut grace = parse_lyrics(
        2,
        "Amazing Grace",
        "[Verse 1]\nAmazing grace! How sweet the sound\nThat saved a wretch like me!\nI once was lost, but now am found;\nWas blind, but now I see.\n\n\
         [Verse 2]\n'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear\nThe hour I first believed.",
        4,
    );
    grace.ccli = Some("22025".into());
    grace.theme = "Worship".into();
    if let Some(first) = grace.slides.first_mut() {
        first.triggers.push(SlideTrigger::LightingCue { cue: 2 });
    }
    let scripture = Presentation {
        id: 3,
        title: "John 3:16 (KJV)".into(),
        kind: PresentationKind::Scripture,
        ccli: None,
        theme: "Scripture".into(),
        slides: vec![Slide {
            id: 1,
            label: "John 3:16".into(),
            text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.".into(),
            triggers: vec![SlideTrigger::LightingText { text: "front spots warm white at 90, back wall blue at 30".into() }],
        }],
    };

    Show {
        name: "Demo — Sunday Service".into(),
        stage: StageConfig::default(),
        profiles: profiles(),
        fixtures,
        groups,
        positions,
        cues,
        dmx_outputs: vec![DmxOutputConfig::Sacn { universe: 1, sacn_universe: 1, priority: 100, unicast_ip: None }],
        presentations: vec![welcome, grace, scripture],
        playlist: vec![1, 2, 3],
        themes: vec![
            Theme::default(),
            Theme {
                name: "Worship".into(),
                font: "Helvetica Neue".into(),
                uppercase: true,
                background_color: "#1a0b2e".into(),
                ..Theme::default()
            },
            Theme {
                name: "Scripture".into(),
                font: "Georgia".into(),
                bold: false,
                size: 0.85,
                background_color: "#14110d".into(),
                ..Theme::default()
            },
            Theme {
                name: "Lower third".into(),
                position: TextPosition::LowerThird,
                size: 0.8,
                background_color: "#00000000".into(),
                ..Theme::default()
            },
        ],
        media: vec![],
        scenery: vec![Scenery {
            id: 1,
            name: "Back wall".into(),
            kind: SceneryKind::Wall,
            position: [0.0, 0.0, -4.0],
            size: [13.5, 5.0, 0.15],
            rotation: [0.0, 0.0, 0.0],
            color: "#b9b4aa".into(),
        }],
        mixer: None,
    }
}
