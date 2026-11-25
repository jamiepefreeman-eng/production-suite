//! The show file: everything all four modules share, saved as one JSON file.

use crate::dmx::DmxOutputConfig;
use crate::lighting::{Cue, Fixture, FixtureProfile, Group, PositionPreset};
use crate::mixer::MixerConfig;
use crate::presenter::{Macro, MediaItem, MediaPlaylist, Presentation, Prop, Theme};

/// Something on stage that light lands on: walls, drapes, risers.
/// Drawn by the Visualizer and the Lighting stage plan; no DMX.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default))]
pub struct Scenery {
    pub id: u32,
    pub name: String,
    pub kind: SceneryKind,
    /// Centre of the bottom face, metres (x across, y up, z toward audience).
    pub position: [f32; 3],
    /// Width, height, thickness in metres.
    pub size: [f32; 3],
    /// Degrees.
    pub rotation: [f32; 3],
    /// CSS colour of the surface.
    pub color: String,
    /// `Model` only: absolute path of an imported 3D file (.stl .obj .dae .glb/.gltf, e.g. from SketchUp).
    pub model_path: String,
    /// `Model` only: units the file was saved in: "m", "cm", "mm", "in", "ft".
    pub model_unit: String,
    /// `Model` only: the file is Z-up (SketchUp, most CAD) rather than Y-up.
    pub model_z_up: bool,
}

impl Default for Scenery {
    fn default() -> Self {
        Scenery {
            id: 0,
            name: "Wall".into(),
            kind: SceneryKind::Wall,
            position: [0.0, 0.0, 0.0],
            size: [4.0, 3.0, 0.1],
            rotation: [0.0, 0.0, 0.0],
            color: "#b9b4aa".into(),
            model_path: String::new(),
            model_unit: "m".into(),
            model_z_up: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum SceneryKind {
    #[default]
    Wall,
    /// Soft fabric: drawn with folds.
    Drape,
    /// Platform / box.
    Riser,
    /// Stage decking with a skirt.
    StageDeck,
    /// Box truss; `size[0]` is the length.
    Truss,
    /// LED wall / projection screen showing the Presenter's audience output.
    Screen,
    Person,
    DrumKit,
    Keyboard,
    Guitarist,
    MicStand,
    Speaker,
    Wedge,
    /// Imported 3D model (set, venue, truss rig…).
    Model,
}

/// Room look in the Visualizer, saved with the show.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default))]
pub struct VisualizerSettings {
    /// 0 = clean air (beams invisible), 1 = thick haze.
    pub haze: f32,
    /// 0 = black room, 1 = house lights up.
    pub ambient: f32,
}

impl Default for VisualizerSettings {
    fn default() -> Self {
        VisualizerSettings { haze: 0.35, ambient: 0.15 }
    }
}

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
    pub themes: Vec<Theme>,
    pub media: Vec<MediaItem>,
    pub media_playlists: Vec<MediaPlaylist>,
    pub props: Vec<Prop>,
    pub macros: Vec<Macro>,
    // Visualizer
    pub scenery: Vec<Scenery>,
    pub visualizer: VisualizerSettings,
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

    /// The theme a presentation uses (falls back to the first theme, then the built-in default).
    pub fn theme_for(&self, presentation: &Presentation) -> Theme {
        self.themes
            .iter()
            .find(|t| t.name == presentation.theme)
            .or(self.themes.first())
            .cloned()
            .unwrap_or_default()
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
