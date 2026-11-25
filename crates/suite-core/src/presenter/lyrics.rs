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
    let has_colon = t.ends_with(':');
    let bare = t.trim_end_matches(':').trim();
    let mut words = bare.split_whitespace();
    let first = words.next()?.to_lowercase();
    if !SECTION_WORDS.contains(&first.as_str()) {
        return None;
    }
    let rest: Vec<&str> = words.collect();
    // "Chorus:" / "Verse 2:" — a colon makes the intent clear.
    if has_colon && rest.len() <= 2 {
        return Some(bare.to_string());
    }
    // Without a colon only accept "Verse", "Verse 2", "Chorus x2", "Verse 1b",
    // so lyric lines like "Chorus of angels" or "Bridge the gap" stay lyrics.
    if rest.iter().all(|w| is_section_suffix(w)) && rest.len() <= 2 {
        return Some(bare.to_string());
    }
    None
}

fn is_section_suffix(w: &str) -> bool {
    let w = w.trim_matches(|c| c == '(' || c == ')').to_lowercase();
    let digits_then_letter = {
        let d = w.trim_end_matches(|c: char| c.is_ascii_alphabetic());
        !d.is_empty() && d.chars().all(|c| c.is_ascii_digit()) && w.len() - d.len() <= 1
    };
    digits_then_letter
        || (w.starts_with('x') && w.len() > 1 && w[1..].chars().all(|c| c.is_ascii_digit()))
        || matches!(w.as_str(), "i" | "ii" | "iii" | "iv" | "v" | "a" | "b" | "c")
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
        groups: vec![],
        arrangements: vec![],
        arrangement: None,
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

    #[test]
    fn lyric_lines_starting_with_section_words_stay_lyrics() {
        let p = parse_lyrics(1, "T", "[Verse 1]\nLine one\n\n[Chorus]\nChorus line\nVerse of praise\nBridge the gap", 4);
        let got: Vec<_> = p.slides.iter().map(|s| (s.label.as_str(), s.text.as_str())).collect();
        assert_eq!(got, vec![("Verse 1", "Line one"), ("Chorus", "Chorus line\nVerse of praise\nBridge the gap")]);
    }

    #[test]
    fn bare_headers_still_recognised() {
        for h in ["Verse", "Verse 2", "Chorus x2", "Chorus (x2)", "Verse 1b", "Pre-Chorus", "Bridge:", "Verse 2:", "Tag"] {
            assert!(section_label(h).is_some(), "{h} should be a header");
        }
        for l in ["Chorus line", "Verse of praise", "Tag you're it", "Bridge over troubled water"] {
            assert!(section_label(l).is_none(), "{l} should be a lyric");
        }
    }
}
