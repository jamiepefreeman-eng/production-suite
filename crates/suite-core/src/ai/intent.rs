/// One instruction for one target, e.g. `Movers: gobo 3, position Centre Stage`.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Intent {
    /// Group name, group alias, fixture name, or "all".
    pub target: String,
    pub actions: Vec<Action>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "type", content = "value", rename_all = "snake_case"))]
pub enum Action {
    /// Percent, 0..=100.
    Intensity(f32),
    /// Color name ("blue", "warm white") or hex ("#ff8800").
    Color(String),
    /// Gobo slot number (0 = open).
    Gobo(u8),
    /// Name of a stored position preset ("Centre Stage").
    Position(String),
    Off,
}

/// Result of parsing a sentence.
#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ParseOutput {
    pub intents: Vec<Intent>,
    /// Clauses or words that couldn't be understood.
    pub unknown: Vec<String>,
}
