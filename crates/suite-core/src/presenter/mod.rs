//! Presenter: songs, scripture and announcements as slides, and the
//! cross-module triggers a slide can fire when it goes live.

pub mod lyrics;

pub use lyrics::parse_lyrics;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum PresentationKind {
    Song,
    Scripture,
    Announcement,
    Media,
}

/// What a slide does to the other modules when it goes live.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "type", rename_all = "snake_case"))]
pub enum SlideTrigger {
    LightingCue { cue: u32 },
    /// Run a plain-language lighting sentence through the AI parser.
    LightingText { text: String },
    Blackout,
    Mixer { command: crate::mixer::MixerCommand },
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Slide {
    pub id: u32,
    /// Section label: "Verse 1", "Chorus", "John 3:16".
    pub label: String,
    pub text: String,
    pub triggers: Vec<SlideTrigger>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Presentation {
    pub id: u32,
    pub title: String,
    pub kind: PresentationKind,
    /// CCLI song number, for reporting.
    pub ccli: Option<String>,
    pub slides: Vec<Slide>,
    /// Name of a theme in the UI (fonts/background); styling lives in the front end.
    pub theme: String,
}

impl Presentation {
    pub fn slide(&self, id: u32) -> Option<&Slide> {
        self.slides.iter().find(|s| s.id == id)
    }

    pub fn slide_mut(&mut self, id: u32) -> Option<&mut Slide> {
        self.slides.iter_mut().find(|s| s.id == id)
    }
}
