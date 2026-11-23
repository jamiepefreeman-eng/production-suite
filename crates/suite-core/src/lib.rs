//! suite-core — the shared show engine.
//!
//! The desktop app is four modules (Presenter, Lighting, Audio, Visualizer)
//! that never call each other directly. They all send [`engine::Command`]s
//! to one [`engine::Engine`] and react to the [`engine::Event`]s it
//! publishes on the [`bus::Bus`]. That is how a slide going live can fire a
//! lighting cue and recall a mixer scene without the modules knowing about
//! each other.
//!
//! Types carry `#[cfg_attr(feature = "serde", ...)]` so this crate builds with
//! zero dependencies; the desktop app enables the `serde` feature.

pub mod ai;
pub mod bus;
pub mod demo;
pub mod dmx;
pub mod engine;
pub mod lighting;
pub mod mixer;
pub mod presenter;
pub mod show;
