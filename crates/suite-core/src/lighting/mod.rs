//! Lighting: fixture profiles, patch, groups, position presets, looks and cues,
//! plus rendering looks to DMX and decoding DMX back to visual state for the
//! Visualizer.

pub mod color;
pub mod fixture;
pub mod look;
pub mod render;

pub use color::Rgb;
pub use fixture::*;
pub use look::*;
pub use render::{decode_visuals, render_look, FixtureVisual};
