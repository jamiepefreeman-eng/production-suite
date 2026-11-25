//! Presenter: songs, scripture and announcements as slides, and the
//! cross-module triggers a slide can fire when it goes live.

pub mod lyrics;

pub use lyrics::parse_lyrics;

/// A file in the media bin. Paths are absolute on the computer that added them.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MediaItem {
    pub id: u32,
    pub name: String,
    pub path: String,
    pub kind: MediaKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum MediaKind {
    Image,
    Video,
    Audio,
    /// Live camera / capture card / NDI-as-webcam; `path` holds the device name.
    Input,
}

impl MediaKind {
    /// From a file extension, for files added to the bin.
    pub fn from_path(path: &str) -> Option<MediaKind> {
        let ext = path.rsplit('.').next()?.to_lowercase();
        match ext.as_str() {
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" => Some(MediaKind::Image),
            "mp4" | "mov" | "m4v" | "webm" => Some(MediaKind::Video),
            "mp3" | "wav" | "m4a" | "aac" | "ogg" | "flac" => Some(MediaKind::Audio),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum TextPosition {
    Top,
    #[default]
    Center,
    Bottom,
    /// Small text in a band at the bottom (stream / sermon notes look).
    LowerThird,
}

/// How slides look: text style and background. Presentations pick one by name.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default))]
pub struct Theme {
    pub name: String,
    pub font: String,
    /// 1.0 = normal size.
    pub size: f32,
    /// CSS colour, e.g. "#ffffff".
    pub color: String,
    pub bold: bool,
    pub uppercase: bool,
    pub shadow: bool,
    pub position: TextPosition,
    /// CSS colour behind everything.
    pub background_color: String,
    /// Image or video from the media bin, drawn over `background_color`.
    pub background_media: Option<u32>,
    /// 0..1 darkening over the background so text stays readable.
    pub dim: f32,
}

impl Default for Theme {
    fn default() -> Self {
        Theme {
            name: "Default".into(),
            font: "Inter".into(),
            size: 1.0,
            color: "#ffffff".into(),
            bold: true,
            uppercase: false,
            shadow: true,
            position: TextPosition::Center,
            background_color: "#0b1020".into(),
            background_media: None,
            dim: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum PresentationKind {
    Song,
    Scripture,
    Announcement,
    Media,
    /// A divider in the service order ("Main Show", "Post Show"); has no slides.
    Header,
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
    /// Put media from the bin on the background layer (`None` clears it).
    Media { media: Option<u32> },
    /// Start (or stop, with `None`) audio from the bin.
    Audio { audio: Option<u32>, looped: bool },
    /// Show or hide a prop (logo, lower-third graphic…).
    Prop { prop: u32, on: bool },
    /// Run a macro (a saved list of these actions).
    Macro { id: u32 },
    /// Clear one presentation layer (or everything).
    Clear { layer: ClearLayer },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum ClearLayer {
    /// Slide, media, audio, props and timer.
    All,
    Slide,
    Media,
    Audio,
    Props,
    Timer,
    /// Release the lighting cue.
    Lights,
}

/// A song section ("Verse 1", "Chorus") with its colour. Slides belong to a
/// group by their `label`; groups listed here add colours and extra names.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SlideGroup {
    pub name: String,
    /// CSS colour.
    pub color: String,
}

/// An order to play the groups in ("Intro, Verse 1, Chorus, Verse 2, Chorus, Bridge…").
/// Several can be saved per song (ProPresenter-style versions).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Arrangement {
    pub name: String,
    pub sequence: Vec<String>,
}

/// An overlay shown on top of slides until hidden: logo bug, lower-third graphic, text.
/// Position and size are fractions of the screen (0..1).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default))]
pub struct Prop {
    pub id: u32,
    pub name: String,
    /// Image / video from the media bin.
    pub media: Option<u32>,
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// Text colour.
    pub color: String,
    /// Box colour behind the text (CSS, may be transparent).
    pub background: String,
}

impl Default for Prop {
    fn default() -> Self {
        Prop {
            id: 0,
            name: "Prop".into(),
            media: None,
            text: String::new(),
            x: 0.03,
            y: 0.04,
            w: 0.14,
            h: 0.1,
            color: "#ffffff".into(),
            background: "#00000000".into(),
        }
    }
}

/// One button that does several things.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Macro {
    pub id: u32,
    pub name: String,
    pub color: String,
    pub actions: Vec<SlideTrigger>,
}

/// A folder in the media bin.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MediaPlaylist {
    pub name: String,
    pub items: Vec<u32>,
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
    /// Extra / recoloured groups (slides belong to a group by label).
    #[cfg_attr(feature = "serde", serde(default))]
    pub groups: Vec<SlideGroup>,
    #[cfg_attr(feature = "serde", serde(default))]
    pub arrangements: Vec<Arrangement>,
    /// Arrangement in use; `None` = slides in their written order.
    #[cfg_attr(feature = "serde", serde(default))]
    pub arrangement: Option<String>,
}

impl Presentation {
    pub fn slide(&self, id: u32) -> Option<&Slide> {
        self.slides.iter().find(|s| s.id == id)
    }

    pub fn slide_mut(&mut self, id: u32) -> Option<&mut Slide> {
        self.slides.iter_mut().find(|s| s.id == id)
    }
}
