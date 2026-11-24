//! Fixture profiles, patched fixtures, groups and position presets.

use super::Rgb;

/// What a single DMX channel of a fixture does.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum Attr {
    Dimmer,
    Red,
    Green,
    Blue,
    White,
    Amber,
    Uv,
    Pan,
    PanFine,
    Tilt,
    TiltFine,
    ColorWheel,
    Gobo,
    GoboRotation,
    Prism,
    Focus,
    Shutter,
    Strobe,
    Speed,
    Control,
    Unused,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ChannelDef {
    pub attr: Attr,
    /// Value sent when nothing in the look controls this channel
    /// (e.g. shutter open = 255 on many movers).
    pub default: u8,
}

#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum FixtureKind {
    Wash,
    Par,
    /// Small floor/wall uplighter (LED puck).
    Puck,
    Strip,
    MovingSpot,
    MovingWash,
    Generic,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ColorSlot {
    pub name: String,
    pub dmx: u8,
    pub rgb: Rgb,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FixtureProfile {
    pub id: String,
    pub manufacturer: String,
    pub model: String,
    pub mode: String,
    pub kind: FixtureKind,
    pub channels: Vec<ChannelDef>,
    /// DMX value for gobo 1, 2, 3 … (index 0 = open).
    pub gobo_slots: Vec<u8>,
    /// Color wheel slots for fixtures without RGB mixing.
    pub color_wheel: Vec<ColorSlot>,
    /// Pan / tilt range in degrees, for the Visualizer.
    pub pan_range: f32,
    pub tilt_range: f32,
    /// Beam angle in degrees, for the Visualizer.
    pub beam_angle: f32,
    /// True when the profile was entered from memory/guesswork and must be
    /// checked against the fixture manual before a show.
    pub needs_verification: bool,
}

impl FixtureProfile {
    pub fn footprint(&self) -> u16 {
        self.channels.len() as u16
    }

    /// 0-based offset of the first channel with this attribute.
    pub fn offset(&self, attr: &Attr) -> Option<u16> {
        self.channels.iter().position(|c| &c.attr == attr).map(|i| i as u16)
    }

    pub fn has(&self, attr: &Attr) -> bool {
        self.offset(attr).is_some()
    }

    pub fn has_rgb(&self) -> bool {
        self.has(&Attr::Red) && self.has(&Attr::Green) && self.has(&Attr::Blue)
    }

    pub fn is_moving(&self) -> bool {
        self.has(&Attr::Pan) || self.has(&Attr::Tilt)
    }
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Fixture {
    pub id: u32,
    pub name: String,
    pub profile_id: String,
    pub universe: u16,
    /// 1-based DMX start address.
    pub address: u16,
    /// Stage position in metres: x = stage left/right, y = height, z = upstage(-)/downstage(+).
    pub position: [f32; 3],
    /// Mounting rotation in degrees (x, y, z), applied to a beam that points straight
    /// up (+y) at 0,0,0. Hung fixtures pointing down are x = 180; a front-of-house
    /// fixture aimed back at the stage is about x = -135.
    pub rotation: [f32; 3],
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Group {
    pub name: String,
    /// Other ways people say it: "front spots", "fronts", "front wash" …
    pub aliases: Vec<String>,
    pub fixtures: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct PanTilt {
    pub fixture: u32,
    /// Normalised 0..1 (0.5 = centre of travel).
    pub pan: f32,
    pub tilt: f32,
}

/// A stored focus point such as "Centre Stage" or "Pulpit".
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct PositionPreset {
    pub name: String,
    pub aliases: Vec<String>,
    pub values: Vec<PanTilt>,
}
