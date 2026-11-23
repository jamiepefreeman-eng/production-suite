//! The show file: everything all four modules share, saved as one JSON file.

use crate::dmx::DmxOutputConfig;
use crate::lighting::{Cue, Fixture, FixtureProfile, Group, PositionPreset};
use crate::mixer::MixerConfig;
use crate::presenter::Presentation;

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct StageConfig {
    /// Metres.
    pub width: f32,
    pub depth: f32,
    pub trim_height: f32,
}

impl Default for StageConfig {
    fn default() -> Self {
        Self { width: 12.0, depth: 8.0, trim_height: 6.0 }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default))]
pub struct Show {
    pub name: String,
    pub stage: StageConfig,
    // Lighting
    pub profiles: Vec<FixtureProfile>,
    pub fixtures: Vec<Fixture>,
    pub groups: Vec<Group>,
    pub positions: Vec<PositionPreset>,
    pub cues: Vec<Cue>,
    pub dmx_outputs: Vec<DmxOutputConfig>,
    // Presenter
    pub presentations: Vec<Presentation>,
    pub playlist: Vec<u32>,
    // Audio
    pub mixer: Option<MixerConfig>,
}

impl Show {
    pub fn profile(&self, id: &str) -> Option<&FixtureProfile> {
        self.profiles.iter().find(|p| p.id == id)
    }

    pub fn fixture(&self, id: u32) -> Option<&Fixture> {
        self.fixtures.iter().find(|f| f.id == id)
    }

    pub fn fixture_mut(&mut self, id: u32) -> Option<&mut Fixture> {
        self.fixtures.iter_mut().find(|f| f.id == id)
    }

    pub fn fixture_profile(&self, id: u32) -> Option<&FixtureProfile> {
        self.fixture(id).and_then(|f| self.profile(&f.profile_id))
    }

    pub fn cue(&self, id: u32) -> Option<&Cue> {
        self.cues.iter().find(|c| c.id == id)
    }

    pub fn presentation(&self, id: u32) -> Option<&crate::presenter::Presentation> {
        self.presentations.iter().find(|p| p.id == id)
    }

    pub fn next_cue_id(&self) -> u32 {
        self.cues.iter().map(|c| c.id).max().unwrap_or(0) + 1
    }

    pub fn next_presentation_id(&self) -> u32 {
        self.presentations.iter().map(|p| p.id).max().unwrap_or(0) + 1
    }

    /// Patch sanity check: overlapping addresses and unknown profiles.
    pub fn patch_warnings(&self) -> Vec<String> {
        let mut warnings = Vec::new();
        let mut used: std::collections::BTreeMap<(u16, u16), u32> = Default::default();
        for f in &self.fixtures {
            let Some(p) = self.profile(&f.profile_id) else {
                warnings.push(format!("{}: unknown profile '{}'", f.name, f.profile_id));
                continue;
            };
            if p.needs_verification {
                warnings.push(format!(
                    "{}: profile {} {} ({}) is unverified — check the channel map against the manual",
                    f.name, p.manufacturer, p.model, p.mode
                ));
            }
            for ch in 0..p.footprint() {
                let addr = f.address + ch;
                if addr > 512 {
                    warnings.push(format!("{}: runs past channel 512", f.name));
                    break;
                }
                if let Some(other) = used.insert((f.universe, addr), f.id) {
                    if other != f.id {
                        warnings.push(format!("{}: overlaps fixture #{} at {}.{}", f.name, other, f.universe, addr));
                        break;
                    }
                }
            }
        }
        warnings.dedup();
        warnings
    }
}
