//! Turn pasted lyrics into slides.
//!
//! ```text
//! [Verse 1]            <- or "Verse 1:" on its own line
//! line one
//! line two
//!
//! line three           <- blank line = new slide in the same section
//! [Chorus]
//! ...
//! ```
//! Long sections are split every `max_lines` lines.

use super::{Presentation, PresentationKind, Slide};

const SECTION_WORDS: &[&str] = &[
    "verse", "chorus", "pre-chorus", "prechorus", "bridge", "tag", "intro", "outro", "ending", "interlude",
    "refrain", "vamp", "turnaround", "instrumental",
];

fn section_label(line: &str) -> Option<String> {
    let t = line.trim();
    if t.starts_with('[') && t.ends_with(']') && t.len() > 2 {
        return Some(t[1..t.len() - 1].trim().to_string());
    }
    let bare = t.trim_end_matches(':');
    let first = bare.split_whitespace().next()?.to_lowercase();
    if SECTION_WORDS.contains(&first.as_str()) && bare.split_whitespace().count() <= 3 {
        return Some(bare.to_string());
    }
    None
}

pub fn parse_lyrics(id: u32, title: &str, text: &str, max_lines: usize) -> Presentation {
    let max_lines = max_lines.max(1);
    let mut slides: Vec<Slide> = Vec::new();
    let mut label = String::from("Lyrics");
    let mut buf: Vec<String> = Vec::new();

    let flush = |label: &str, buf: &mut Vec<String>, slides: &mut Vec<Slide>| {
        for chunk in buf.chunks(max_lines) {
            slides.push(Slide {
                id: slides.len() as u32 + 1,
                label: label.to_string(),
                text: chunk.join("\n"),
                triggers: vec![],
            });
        }
        buf.clear();
    };

    for line in text.lines() {
        if let Some(l) = section_label(line) {
            flush(&label, &mut buf, &mut slides);
            label = l;
        } else if line.trim().is_empty() {
            flush(&label, &mut buf, &mut slides);
        } else {
            buf.push(line.trim().to_string());
        }
    }
    flush(&label, &mut buf, &mut slides);

    Presentation {
        id,
        title: title.to_string(),
        kind: PresentationKind::Song,
        ccli: None,
        slides,
        theme: "Default".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sections_and_splits() {
        let p = parse_lyrics(1, "Test", "[Verse 1]\na\nb\nc\nd\ne\n\nf\nChorus:\ng\nh", 4);
        let labels: Vec<_> = p.slides.iter().map(|s| (s.label.as_str(), s.text.as_str())).collect();
        assert_eq!(
            labels,
            vec![("Verse 1", "a\nb\nc\nd"), ("Verse 1", "e"), ("Verse 1", "f"), ("Chorus", "g\nh")]
        );
        assert_eq!(p.slides[3].id, 4);
    }
}
