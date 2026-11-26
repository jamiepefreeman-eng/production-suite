//! Song files from CCLI SongSelect and other chart sites → a song presentation.
//!
//! Understands:
//! * **SongSelect lyrics (.txt)** — title on the first line, section headings ("Verse 1", "Chorus"),
//!   then a footer: `CCLI Song # 4768151`, writers (`A | B | C`), `© …`, licence / terms lines.
//! * **ChordPro (.cho, .chordpro, .chopro, .crd)** — `{title: …}`, `{ccli: …}`, `{artist: …}`,
//!   `{copyright: …}`, `{start_of_verse: Verse 1}` … `{end_of_verse}`, `{soc}`, `{comment: Bridge}`, and
//!   chords in brackets (`[G]Amazing [D]grace`) which are removed.
//! * Anything else: plain lyrics with headings, like the "+ Song" box.
//!
//! Planning Center arrangement lyrics use the same heading style and go through `import_song` too.

use super::lyrics::{parse_lyrics, section_label};
use super::Presentation;

/// Parse a song file / pasted text. `fallback_title` is used when the text has none (e.g. the file name).
pub fn import_song(id: u32, text: &str, fallback_title: &str, max_lines: usize) -> Presentation {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let text = text.trim_start_matches('\u{feff}');
    if is_chordpro(text) {
        chordpro(id, text, fallback_title, max_lines)
    } else {
        songselect(id, text, fallback_title, max_lines)
    }
}

fn is_chordpro(text: &str) -> bool {
    text.lines().filter(|l| l.trim().starts_with('{') && l.trim().ends_with('}')).take(2).count() >= 1
        && text.lines().any(|l| {
            let t = l.trim().to_lowercase();
            t.starts_with("{title") || t.starts_with("{t:") || t.starts_with("{start_of") || t.starts_with("{so") || t.starts_with("{c:") || t.starts_with("{comment")
        })
}

/// Remove `[G]`, `[D/F#]` chords; a line that was only chords becomes empty.
fn strip_chords(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut depth = 0;
    for c in line.chars() {
        match c {
            '[' => depth += 1,
            ']' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// "VERSE 1" → "Verse 1", "PRE-CHORUS" → "Pre-Chorus" (so groups get their usual colours).
fn tidy_label(l: &str) -> String {
    if l.chars().any(|c| c.is_lowercase()) {
        return l.to_string();
    }
    l.split(' ')
        .map(|w| w.split('-').map(|p| capitalise(&p.to_lowercase())).collect::<Vec<_>>().join("-"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn finish(mut p: Presentation, title: String, ccli: Option<String>, authors: Vec<String>, copyright: Vec<String>) -> Presentation {
    for s in &mut p.slides {
        s.label = tidy_label(&s.label);
    }
    p.title = title;
    p.ccli = ccli.filter(|c| !c.is_empty());
    p.authors = authors.join(" | ");
    p.copyright = copyright.join(" ");
    p
}

fn chordpro(id: u32, text: &str, fallback_title: &str, max_lines: usize) -> Presentation {
    let mut title = String::new();
    let mut ccli = None;
    let mut authors: Vec<String> = Vec::new();
    let mut copyright: Vec<String> = Vec::new();
    let mut body = String::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with('#') {
            continue; // ChordPro comment
        }
        if line.starts_with('{') && line.ends_with('}') {
            let inner = &line[1..line.len() - 1];
            let (key, val) = match inner.split_once(':') {
                Some((k, v)) => (k.trim().to_lowercase(), v.trim().to_string()),
                None => (inner.trim().to_lowercase(), String::new()),
            };
            match key.as_str() {
                "title" | "t" => title = val,
                "ccli" | "ccli_song" | "ccli_number" => ccli = Some(val.chars().filter(|c| c.is_ascii_digit()).collect()),
                "artist" | "composer" | "lyricist" | "author" | "subtitle" | "st" if !val.is_empty() => {
                    if !authors.contains(&val) {
                        authors.push(val)
                    }
                }
                "copyright" | "footer" if !val.is_empty() => copyright.push(val),
                k if k.starts_with("start_of_") || matches!(k, "soc" | "sov" | "sob" | "sot") => {
                    let kind = match k {
                        "soc" => "chorus",
                        "sov" => "verse",
                        "sob" => "bridge",
                        "sot" => "tab",
                        _ => k.trim_start_matches("start_of_"),
                    };
                    if kind == "tab" || kind == "grid" {
                        continue;
                    }
                    let label = if val.is_empty() { capitalise(kind) } else { val };
                    body.push_str(&format!("\n[{label}]\n"));
                }
                // Comments are usually section names ("Verse 2", "Chorus x2").
                "comment" | "c" | "comment_italic" | "ci" | "comment_box" | "cb" | "highlight" if section_label(&val).is_some() => {
                    body.push_str(&format!("\n[{val}]\n"));
                }
                _ => {} // key, tempo, end_of_*, chorus recall, etc.
            }
            continue;
        }
        let l = strip_chords(raw);
        if l.is_empty() && !raw.trim().is_empty() {
            continue; // a chord-only line
        }
        body.push_str(&l);
        body.push('\n');
    }
    let t = if title.is_empty() { fallback_title.to_string() } else { title };
    finish(parse_lyrics(id, &t, &body, max_lines), t, ccli, authors, copyright)
}

fn capitalise(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

fn songselect(id: u32, text: &str, fallback_title: &str, max_lines: usize) -> Presentation {
    let lines: Vec<&str> = text.lines().collect();
    // Footer: from "CCLI Song #" (or a © / licence line) to the end.
    let footer_start = lines.iter().position(|l| {
        let t = l.trim().to_lowercase();
        t.starts_with("ccli song") || t.starts_with("ccli-song") || t.starts_with("ccli license") || t.starts_with("for use solely with the songselect")
    });
    let (body_lines, footer) = match footer_start {
        Some(i) => (&lines[..i], &lines[i..]),
        None => (&lines[..], &lines[0..0]),
    };
    let mut ccli = None;
    let mut authors: Vec<String> = Vec::new();
    let mut copyright: Vec<String> = Vec::new();
    for l in footer {
        let t = l.trim();
        let low = t.to_lowercase();
        if t.is_empty() || low.starts_with("for use solely") || low.starts_with("ccli license") || low.contains("www.ccli.com") || low.starts_with("note:") {
            continue;
        }
        if low.starts_with("ccli song") || low.starts_with("ccli-song") {
            ccli = Some(t.chars().filter(|c| c.is_ascii_digit()).collect());
        } else if t.starts_with('©') || low.starts_with("copyright") || low.starts_with("(c)") {
            copyright.push(t.to_string());
        } else if copyright.is_empty() {
            authors.extend(t.split('|').map(|a| a.trim().to_string()).filter(|a| !a.is_empty()));
        } else {
            copyright.push(t.to_string()); // publisher lines continuing the ©
        }
    }
    // Title: the first line, when it isn't a heading or lyric block start (followed by a blank or a heading).
    let mut start = 0;
    let mut title = String::new();
    if let Some(first) = body_lines.iter().position(|l| !l.trim().is_empty()) {
        let cand = body_lines[first].trim();
        let next = body_lines.get(first + 1).map(|l| l.trim()).unwrap_or("");
        if section_label(cand).is_none() && (next.is_empty() || section_label(next).is_some()) {
            title = cand.to_string();
            start = first + 1;
        }
    }
    let t = if title.is_empty() { fallback_title.to_string() } else { title };
    let body = body_lines[start..].join("\n");
    finish(parse_lyrics(id, &t, &body, max_lines), t, ccli, authors, copyright)
}

/// The copyright notice CCLI asks churches to show with the lyrics.
pub fn ccli_notice(p: &Presentation, license: &str) -> String {
    let mut parts: Vec<String> = vec![];
    let mut head = format!("“{}”", p.title);
    if !p.authors.is_empty() {
        head.push_str(&format!(" — {}", p.authors.replace(" | ", ", ")));
    }
    parts.push(head);
    if !p.copyright.is_empty() {
        parts.push(p.copyright.clone());
    }
    let mut ccli = vec![];
    if let Some(n) = &p.ccli {
        ccli.push(format!("CCLI Song # {n}"));
    }
    if !license.trim().is_empty() {
        ccli.push(format!("CCLI License # {}", license.trim()));
    }
    if !ccli.is_empty() {
        parts.push(ccli.join(" · "));
    }
    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SONGSELECT: &str = "Amazing Grace (My Chains Are Gone)\n\nVerse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\nChorus 1\nMy chains are gone\nI've been set free\n\nBridge\nThe earth shall soon dissolve like snow\n\nCCLI Song # 4768151\nChris Tomlin | John Newton | Louie Giglio\n© 2006 sixsteps Music (ASCAP) worshiptogether.com songs (ASCAP)\n(Admin. by Capitol CMG Publishing)\nFor use solely with the SongSelect® Terms of Use. All rights reserved. www.ccli.com\nCCLI License # 1234567\n";

    #[test]
    fn songselect_text() {
        let p = import_song(1, SONGSELECT, "file", 4);
        assert_eq!(p.title, "Amazing Grace (My Chains Are Gone)");
        assert_eq!(p.ccli.as_deref(), Some("4768151"));
        assert_eq!(p.authors, "Chris Tomlin | John Newton | Louie Giglio");
        assert!(p.copyright.starts_with("© 2006 sixsteps") && p.copyright.contains("Admin. by Capitol"));
        let labels: Vec<&str> = p.slides.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(labels, vec!["Verse 1", "Chorus 1", "Bridge"]);
        assert!(!p.slides.iter().any(|s| s.text.contains("CCLI")));
        let n = ccli_notice(&p, "1234567");
        assert!(n.contains("CCLI Song # 4768151 · CCLI License # 1234567") && n.contains("Chris Tomlin, John Newton"));
    }

    #[test]
    fn chordpro_file() {
        let cp = "{title: Way Maker}\n{artist: Sinach}\n{ccli: 7115744}\n{copyright: 2016 Integrity Music}\n{key: E}\n\n{start_of_verse: Verse 1}\n[E]You are here, [B]moving in our [C#m]midst\n[A]\n[E]I worship You\n{end_of_verse}\n\n{soc}\nWay [E]maker, miracle [B]worker\n{eoc}\n{c: Bridge}\nEven when I don't see it\n";
        let p = import_song(2, cp, "file", 4);
        assert_eq!(p.title, "Way Maker");
        assert_eq!(p.ccli.as_deref(), Some("7115744"));
        assert_eq!(p.authors, "Sinach");
        assert_eq!(p.copyright, "2016 Integrity Music");
        let s: Vec<(&str, &str)> = p.slides.iter().map(|s| (s.label.as_str(), s.text.as_str())).collect();
        assert_eq!(s, vec![("Verse 1", "You are here, moving in our midst\nI worship You"), ("Chorus", "Way maker, miracle worker"), ("Bridge", "Even when I don't see it")]);
    }

    #[test]
    fn plain_lyrics_use_file_name() {
        let p = import_song(3, "Verse 1\nline one\nline two\n\nChorus\nla la", "My Song", 4);
        assert_eq!(p.title, "My Song");
        assert_eq!(p.slides.len(), 2);
        assert_eq!(p.ccli, None);
    }

    #[test]
    fn planning_center_caps_headings() {
        let p = import_song(4, "VERSE 1\nHere I am\n\nCHORUS\nHoly holy", "Here I Am", 4);
        assert_eq!(p.slides[0].label, "Verse 1");
        assert_eq!(p.slides[1].label, "Chorus");
    }
}
