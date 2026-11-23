//! Colors and the plain-language color vocabulary used by the AI scene builder.

#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Rgb {
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

impl Rgb {
    pub const fn new(r: f32, g: f32, b: f32) -> Self {
        Self { r, g, b }
    }

    pub fn distance(&self, o: &Rgb) -> f32 {
        (self.r - o.r).powi(2) + (self.g - o.g).powi(2) + (self.b - o.b).powi(2)
    }

    /// Accepts "#00ff88", "00ff88" or a known color name.
    pub fn parse(s: &str) -> Option<Rgb> {
        let s = s.trim().to_lowercase();
        if let Some(c) = named(&s) {
            return Some(c);
        }
        let hex = s.trim_start_matches('#');
        if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            let v = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok().map(|x| x as f32 / 255.0);
            return Some(Rgb::new(v(0)?, v(2)?, v(4)?));
        }
        None
    }
}

/// Color names, longest first so "warm white" wins over "white".
pub const COLOR_NAMES: &[(&str, Rgb)] = &[
    ("warm white", Rgb::new(1.0, 0.78, 0.5)),
    ("cool white", Rgb::new(0.85, 0.92, 1.0)),
    ("deep blue", Rgb::new(0.0, 0.0, 1.0)),
    ("light blue", Rgb::new(0.4, 0.7, 1.0)),
    ("sky blue", Rgb::new(0.4, 0.75, 1.0)),
    ("congo blue", Rgb::new(0.2, 0.0, 1.0)),
    ("lavender", Rgb::new(0.7, 0.5, 1.0)),
    ("magenta", Rgb::new(1.0, 0.0, 1.0)),
    ("purple", Rgb::new(0.55, 0.0, 1.0)),
    ("violet", Rgb::new(0.55, 0.0, 1.0)),
    ("orange", Rgb::new(1.0, 0.45, 0.0)),
    ("yellow", Rgb::new(1.0, 0.9, 0.0)),
    ("amber", Rgb::new(1.0, 0.65, 0.0)),
    ("green", Rgb::new(0.0, 1.0, 0.0)),
    ("white", Rgb::new(1.0, 1.0, 1.0)),
    ("pink", Rgb::new(1.0, 0.4, 0.7)),
    ("cyan", Rgb::new(0.0, 1.0, 1.0)),
    ("teal", Rgb::new(0.0, 0.8, 0.7)),
    ("blue", Rgb::new(0.0, 0.0, 1.0)),
    ("red", Rgb::new(1.0, 0.0, 0.0)),
    ("uv", Rgb::new(0.35, 0.0, 1.0)),
];

pub fn named(name: &str) -> Option<Rgb> {
    COLOR_NAMES.iter().find(|(n, _)| *n == name).map(|(_, c)| *c)
}
