//! Looks (what each fixture should be doing) and cues (stored looks + timing).

use super::Rgb;
use std::collections::BTreeMap;

/// Per-fixture state. `None` means "this look doesn't control it".
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FixtureState {
    /// 0..1
    pub intensity: Option<f32>,
    pub color: Option<Rgb>,
    /// 0 = open, 1.. = gobo slot
    pub gobo: Option<u8>,
    /// 0..1 normalised
    pub pan: Option<f32>,
    pub tilt: Option<f32>,
}

impl FixtureState {
    /// Layer `top` over `self`; anything `top` sets wins.
    pub fn merged(&self, top: &FixtureState) -> FixtureState {
        FixtureState {
            intensity: top.intensity.or(self.intensity),
            color: top.color.or(self.color),
            gobo: top.gobo.or(self.gobo),
            pan: top.pan.or(self.pan),
            tilt: top.tilt.or(self.tilt),
        }
    }

    pub fn is_empty(&self) -> bool {
        *self == FixtureState::default()
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Look {
    pub fixtures: BTreeMap<u32, FixtureState>,
}

impl Look {
    pub fn state_mut(&mut self, fixture: u32) -> &mut FixtureState {
        self.fixtures.entry(fixture).or_default()
    }

    pub fn merged(&self, top: &Look) -> Look {
        let mut out = self.clone();
        for (id, st) in &top.fixtures {
            let base = out.fixtures.get(id).cloned().unwrap_or_default();
            out.fixtures.insert(*id, base.merged(st));
        }
        out
    }

    pub fn clear(&mut self) {
        self.fixtures.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.fixtures.values().all(|s| s.is_empty())
    }
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Cue {
    pub id: u32,
    pub name: String,
    pub look: Look,
    pub fade_ms: u32,
    /// The sentence that built it, if the AI scene builder made it.
    pub source_text: Option<String>,
}
