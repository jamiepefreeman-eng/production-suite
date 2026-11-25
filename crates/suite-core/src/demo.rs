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
    ChannelDef { attr, default: 0, name: String::new() }
}

fn ch_default(attr: Attr, default: u8) -> ChannelDef {
    ChannelDef { attr, default, name: String::new() }
}

pub fn profiles() -> Vec<FixtureProfile> {
    vec![
        FixtureProfile {
            id: "adj-cob-cannon-wash-4ch".into(),
            manufacturer: "American DJ".into(),
            model: "COB Cannon Wash".into(),
            mode: "Mode 2 (4ch)".into(),
            kind: FixtureKind::Wash,
            // 4-channel mode = Red, Green, Blue, Amber (confirmed by the Open Fixture Library).
            channels: vec![ch(Attr::Red), ch(Attr::Green), ch(Attr::Blue), ch(Attr::Amber)],
            gobo_slots: vec![],
            color_wheel: vec![],
            pan_range: 0.0,
            tilt_range: 0.0,
            beam_angle: 40.0,
            needs_verification: false,
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
            kind: FixtureKind::Puck,
            channels: vec![ch(Attr::Red), ch(Attr::Green), ch(Attr::Blue)],
            gobo_slots: vec![],
            color_wheel: vec![],
            pan_range: 0.0,
            tilt_range: 0.0,
            beam_angle: 40.0,
            needs_verification: false,
        },
        FixtureProfile {
            id: "chauvet-intimidator-spot-led-250-advanced".into(),
            manufacturer: "Chauvet".into(),
            model: "Intimidator Spot LED 250".into(),
            mode: "Advanced (13ch)".into(),
            kind: FixtureKind::MovingSpot,
            // From the QLC+ fixture library (community-maintained), Advanced mode.
            channels: vec![
                ch_default(Attr::Pan, 128),
                ch(Attr::PanFine),
                ch_default(Attr::Tilt, 128),
                ch(Attr::TiltFine),
                ch(Attr::Speed),
                ch(Attr::ColorWheel),
                ch(Attr::Gobo),
                ch(Attr::GoboRotation),
                ch(Attr::Prism),
                ch(Attr::Dimmer),
                ch_default(Attr::Shutter, 4),
                ch(Attr::Control),
                ch(Attr::Control),
            ],
            gobo_slots: vec![0, 8, 16, 24, 32, 40, 48, 56],
            color_wheel: vec![
                ColorSlot { name: "White".into(), dmx: 0, rgb: Rgb::new(1.0, 1.0, 1.0) },
                ColorSlot { name: "Yellow".into(), dmx: 7, rgb: Rgb::new(1.0, 1.0, 0.0) },
                ColorSlot { name: "Pink".into(), dmx: 14, rgb: Rgb::new(1.0, 0.33, 0.5) },
                ColorSlot { name: "Green".into(), dmx: 21, rgb: Rgb::new(0.0, 0.67, 0.0) },
                ColorSlot { name: "Red".into(), dmx: 28, rgb: Rgb::new(1.0, 0.0, 0.0) },
                ColorSlot { name: "Light blue".into(), dmx: 35, rgb: Rgb::new(0.68, 0.85, 0.9) },
                ColorSlot { name: "Kelly green".into(), dmx: 42, rgb: Rgb::new(0.33, 1.0, 0.0) },
                ColorSlot { name: "Orange".into(), dmx: 49, rgb: Rgb::new(1.0, 0.33, 0.0) },
                ColorSlot { name: "Dark blue".into(), dmx: 56, rgb: Rgb::new(0.0, 0.0, 0.55) },
            ],
            pan_range: 540.0,
            tilt_range: 270.0,
            beam_angle: 17.0,
            needs_verification: false,
        },
        FixtureProfile {
            id: "mdac-backlight-8ch".into(),
            manufacturer: "MDAC".into(),
            model: "Backlight".into(),
            mode: "Mode 1 (8ch)".into(),
            kind: FixtureKind::Par,
            // VERIFY: 8 channels in the Lightkey patch; assumed same layout as the MDAC Curtain.
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
            beam_angle: 30.0,
            needs_verification: true,
        },
    ]
}

/// The church's real rig, from the Lightkey patch ("COR", universe 1, Open DMX USB).
/// Positions are a sensible stage layout — adjust them in the Visualizer.
pub fn demo_show() -> Show {
    let mut fixtures = Vec::new();
    let mut next_id = 1u32;
    let mut add = |name: &str, profile: &str, address: u16, pos: [f32; 3], rot: [f32; 3], fixtures: &mut Vec<Fixture>| {
        fixtures.push(Fixture {
            id: next_id,
            name: name.into(),
            profile_id: profile.into(),
            universe: 1,
            address,
            position: pos,
            rotation: rot,
        });
        next_id += 1;
        next_id - 1
    };

    // P15 / P16: ADJ COB Cannon Wash (4ch) on the front truss, aimed back at the stage.
    let fronts: Vec<u32> = [("Front 1", 1u16, -2.5f32), ("Front 2", 5, 2.5)]
        .into_iter()
        .map(|(n, a, x)| add(n, "adj-cob-cannon-wash-4ch", a, [x, 5.0, 5.0], [-135.0, 0.0, 0.0], &mut fixtures))
        .collect();
    // P1–P12: MDAC Curtain pucks on the floor, washing up the back wall (left to right).
    let curtain_addr: [u16; 12] = [241, 249, 257, 25, 33, 41, 49, 57, 65, 73, 81, 89];
    let curtains: Vec<u32> = curtain_addr
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let x = -5.5 + i as f32 * 1.0;
            add(&format!("Curtain {}", i + 1), "mdac-curtain-8ch", *a, [x, 0.05, -3.6], [-12.0, 0.0, 0.0], &mut fixtures)
        })
        .collect();
    // P18 / P19: MDAC Sidewall pucks on the floor, washing up the side walls.
    let sides: Vec<u32> = [("Sidewall L", 97u16, -6.2f32, 12.0f32), ("Sidewall R", 100, 6.2, -12.0)]
        .into_iter()
        .map(|(n, a, x, rz)| add(n, "mdac-sidewall-3ch", a, [x, 0.05, 0.0], [0.0, 0.0, rz], &mut fixtures))
        .collect();
    // P17 / P18: MDAC Backlights upstage, aimed out over the stage.
    let backs: Vec<u32> = [("Backlight L", 103u16, -3.0f32), ("Backlight R", 111, 3.0)]
        .into_iter()
        .map(|(n, a, x)| add(n, "mdac-backlight-8ch", a, [x, 0.3, -3.2], [30.0, 0.0, 0.0], &mut fixtures))
        .collect();
    // MH5–MH8: Chauvet Intimidator Spot LED 250 (13ch Advanced) on the mid truss, hung.
    let movers: Vec<u32> = [("MH5", 145u16), ("MH6", 158), ("MH7", 184), ("MH8", 171)]
        .into_iter()
        .enumerate()
        .map(|(i, (n, a))| {
            let x = -4.5 + i as f32 * 3.0;
            add(n, "chauvet-intimidator-spot-led-250-advanced", a, [x, 6.0, 0.0], [180.0, 0.0, 0.0], &mut fixtures)
        })
        .collect();

    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    let groups = vec![
        Group { name: "Back Wall".into(), aliases: s(&["curtains", "curtain", "backdrop", "upstage wall", "back"]), fixtures: curtains.clone() },
        Group { name: "Front Wash".into(), aliases: s(&["front spots", "front lights", "fronts", "front", "cannons"]), fixtures: fronts.clone() },
        Group { name: "Side Walls".into(), aliases: s(&["sidewalls", "sides", "side wall", "side lights"]), fixtures: sides.clone() },
        Group { name: "Movers".into(), aliases: s(&["moving heads", "moving lights", "spots", "intimidators", "heads"]), fixtures: movers.clone() },
        Group { name: "Backlights".into(), aliases: s(&["backlight", "back lights", "backlighting", "rear lights"]), fixtures: backs.clone() },
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
    let mut worship =
        look(&[(&curtains, 1.0, purple), (&sides, 0.8, blue), (&fronts, 0.85, warm), (&backs, 0.7, blue), (&movers, 1.0, Rgb::new(1.0, 1.0, 1.0))]);
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
        name: "COR — Sunday Service".into(),
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
        },
        Scenery {
            id: 2,
            name: "Side wall L".into(),
            kind: SceneryKind::Wall,
            position: [-6.6, 0.0, 0.0],
            size: [8.0, 4.0, 0.15],
            rotation: [0.0, 90.0, 0.0],
            color: "#b9b4aa".into(),
        },
        Scenery {
            id: 3,
            name: "Side wall R".into(),
            kind: SceneryKind::Wall,
            position: [6.6, 0.0, 0.0],
            size: [8.0, 4.0, 0.15],
            rotation: [0.0, 90.0, 0.0],
            color: "#b9b4aa".into(),
        }],
        mixer: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The demo is the church's real patch: nothing may overlap.
    #[test]
    fn real_patch_has_no_overlaps() {
        let show = demo_show();
        let overlaps: Vec<_> = show.patch_warnings().into_iter().filter(|w| !w.contains("unverified")).collect();
        assert!(overlaps.is_empty(), "{overlaps:?}");
        let mh7 = show.fixtures.iter().find(|f| f.name == "MH7").unwrap();
        assert_eq!(mh7.address, 184);
        assert_eq!(show.fixtures.iter().filter(|f| f.profile_id == "mdac-curtain-8ch").count(), 12);
    }
}
