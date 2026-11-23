//! Offline plain-language parser.
//!
//! Handles sentences like:
//! `back wall blue, front spots on at 75, movers gobo 3 location centre stage`
//!
//! Vocabulary comes from the show itself: group names + aliases, fixture
//! names and position preset names + aliases. Add an alias in the Lighting
//! module and the parser understands it immediately.

use super::intent::{Action, Intent, ParseOutput};
use crate::lighting::color::COLOR_NAMES;
use crate::show::Show;

const FILLER: &[&str] = &[
    "on", "at", "to", "the", "a", "location", "position", "point", "pointed", "focus", "focused", "set", "make",
    "go", "percent", "level", "intensity", "please", "color", "colour", "in", "of", "with", "and", "then",
    "all", "should", "be", "turn", "bring", "up", "lights", "light", "fixtures", "are", "is",
];

fn normalize(s: &str) -> String {
    let lower = s.to_lowercase().replace("center", "centre");
    lower
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '%' || c == '#' || c == ',' || c == ';' || c == '.' { c } else { ' ' })
        .collect()
}

fn words(s: &str) -> Vec<String> {
    s.split_whitespace().map(|w| w.trim_matches('.').to_string()).filter(|w| !w.is_empty()).collect()
}

fn singular(w: &str) -> &str {
    if w.len() > 3 && w.ends_with('s') && !w.ends_with("ss") {
        &w[..w.len() - 1]
    } else {
        w
    }
}

fn same(a: &str, b: &str) -> bool {
    a == b || singular(a) == singular(b)
}

/// Find `phrase` as a contiguous run in `tokens`, skipping consumed tokens.
fn find_phrase(tokens: &[String], used: &[bool], phrase: &[String]) -> Option<usize> {
    if phrase.is_empty() || phrase.len() > tokens.len() {
        return None;
    }
    (0..=tokens.len() - phrase.len()).find(|&i| {
        phrase
            .iter()
            .enumerate()
            .all(|(j, p)| !used[i + j] && same(&tokens[i + j], p))
    })
}

/// Pick the longest matching candidate; returns (canonical name, start, len).
fn best_match(tokens: &[String], used: &[bool], candidates: &[(String, Vec<String>)]) -> Option<(String, usize, usize)> {
    let mut best: Option<(String, usize, usize)> = None;
    for (canonical, phrase) in candidates {
        if let Some(start) = find_phrase(tokens, used, phrase) {
            if best.as_ref().is_none_or(|b| phrase.len() > b.2) {
                best = Some((canonical.clone(), start, phrase.len()));
            }
        }
    }
    best
}

fn mark(used: &mut [bool], start: usize, len: usize) {
    for u in used.iter_mut().skip(start).take(len) {
        *u = true;
    }
}

fn number(tok: &str) -> Option<f32> {
    tok.trim_end_matches('%').parse::<f32>().ok()
}

struct Vocab {
    targets: Vec<(String, Vec<String>)>,
    positions: Vec<(String, Vec<String>)>,
    colors: Vec<(String, Vec<String>)>,
}

fn vocab(show: &Show) -> Vocab {
    let phrase = |s: &str| words(&normalize(s));
    let mut targets = Vec::new();
    for g in &show.groups {
        targets.push((g.name.clone(), phrase(&g.name)));
        for a in &g.aliases {
            targets.push((g.name.clone(), phrase(a)));
        }
    }
    for f in &show.fixtures {
        targets.push((f.name.clone(), phrase(&f.name)));
    }
    for all in ["everything", "everyone", "all lights", "all fixtures", "the rig", "whole rig"] {
        targets.push(("all".into(), phrase(all)));
    }
    let mut positions = Vec::new();
    for p in &show.positions {
        positions.push((p.name.clone(), phrase(&p.name)));
        for a in &p.aliases {
            positions.push((p.name.clone(), phrase(a)));
        }
    }
    let colors = COLOR_NAMES.iter().map(|(n, _)| (n.to_string(), phrase(n))).collect();
    Vocab { targets, positions, colors }
}

fn split_clauses(text: &str) -> Vec<String> {
    // Sentence breaks act like commas; decimals ("0.5") are left alone.
    let norm = normalize(text).replace(". ", ", ");
    let norm = norm.trim_end_matches('.');
    norm.split([',', ';'])
        .flat_map(|part| part.split(" and ").map(|s| s.to_string()).collect::<Vec<_>>())
        .flat_map(|part| part.split(" then ").map(|s| s.to_string()).collect::<Vec<_>>())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn parse(show: &Show, text: &str) -> ParseOutput {
    let v = vocab(show);
    let mut out = ParseOutput::default();
    let mut last_target: Option<String> = None;

    for clause in split_clauses(text) {
        let tokens = words(&clause);
        let mut used = vec![false; tokens.len()];
        let mut actions = Vec::new();

        // Whole-rig shortcuts.
        if tokens.iter().any(|t| t == "blackout") {
            out.intents.push(Intent { target: "all".into(), actions: vec![Action::Off] });
            continue;
        }

        let target = match best_match(&tokens, &used, &v.targets) {
            Some((name, s, l)) => {
                mark(&mut used, s, l);
                Some(name)
            }
            None if tokens.first().map(|t| t == "all").unwrap_or(false) => {
                used[0] = true;
                Some("all".to_string())
            }
            None => last_target.clone(),
        };
        let Some(target) = target else {
            out.unknown.push(clause.clone());
            continue;
        };

        if let Some((name, s, l)) = best_match(&tokens, &used, &v.positions) {
            mark(&mut used, s, l);
            actions.push(Action::Position(name));
        }

        if let Some((name, s, l)) = best_match(&tokens, &used, &v.colors) {
            mark(&mut used, s, l);
            actions.push(Action::Color(name));
        }

        let mut intensity: Option<f32> = None;
        let mut saw_on = false;
        let mut i = 0;
        while i < tokens.len() {
            if used[i] {
                i += 1;
                continue;
            }
            let t = tokens[i].as_str();
            match t {
                "gobo" => {
                    used[i] = true;
                    if let Some(next) = tokens.get(i + 1) {
                        if let Some(n) = number(next) {
                            actions.push(Action::Gobo(n.max(0.0) as u8));
                            used[i + 1] = true;
                        } else if next == "open" || next == "off" || next == "out" {
                            actions.push(Action::Gobo(0));
                            used[i + 1] = true;
                        }
                    }
                }
                "no" if tokens.get(i + 1).map(|n| n == "gobo").unwrap_or(false) => {
                    actions.push(Action::Gobo(0));
                    used[i] = true;
                    used[i + 1] = true;
                }
                "off" | "out" | "dark" => {
                    actions.push(Action::Off);
                    used[i] = true;
                }
                "full" => {
                    intensity = Some(100.0);
                    used[i] = true;
                }
                "half" => {
                    intensity = Some(50.0);
                    used[i] = true;
                }
                "on" => {
                    saw_on = true;
                    used[i] = true;
                }
                _ if t.starts_with('#') => {
                    actions.push(Action::Color(t.to_string()));
                    used[i] = true;
                }
                _ => {
                    if let Some(n) = number(t) {
                        intensity = Some(n.clamp(0.0, 100.0));
                        used[i] = true;
                    }
                }
            }
            i += 1;
        }
        if let Some(n) = intensity {
            actions.push(Action::Intensity(n));
        } else if saw_on && !actions.contains(&Action::Off) {
            actions.push(Action::Intensity(100.0));
        }

        let leftovers: Vec<&str> = tokens
            .iter()
            .zip(&used)
            .filter(|(t, u)| !**u && !FILLER.contains(&t.as_str()))
            .map(|(t, _)| t.as_str())
            .collect();
        if !leftovers.is_empty() {
            out.unknown.push(leftovers.join(" "));
        }

        if actions.is_empty() {
            if leftovers.is_empty() {
                out.unknown.push(clause.clone());
            }
            continue;
        }
        last_target = Some(target.clone());
        out.intents.push(Intent { target, actions });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo::demo_show;

    #[test]
    fn the_example_sentence() {
        let show = demo_show();
        let out = parse(&show, "Back wall blue. Front Spots on at 75, movers gobo 3 location centre stage");
        assert!(out.unknown.is_empty(), "unknown: {:?}", out.unknown);
        assert_eq!(out.intents.len(), 2 + 1, "{:?}", out.intents);
        assert_eq!(out.intents[0], Intent { target: "Back Wall".into(), actions: vec![Action::Color("blue".into())] });
        assert_eq!(out.intents[1], Intent { target: "Front Wash".into(), actions: vec![Action::Intensity(75.0)] });
        assert_eq!(
            out.intents[2],
            Intent {
                target: "Movers".into(),
                actions: vec![Action::Position("Centre Stage".into()), Action::Gobo(3)]
            }
        );
    }

    #[test]
    fn inherits_target_and_handles_off() {
        let show = demo_show();
        let out = parse(&show, "movers red and 50%, side walls off");
        assert_eq!(out.intents[0].target, "Movers");
        assert_eq!(out.intents[1], Intent { target: "Movers".into(), actions: vec![Action::Intensity(50.0)] });
        assert_eq!(out.intents[2], Intent { target: "Side Walls".into(), actions: vec![Action::Off] });
    }

    #[test]
    fn reports_unknowns() {
        let show = demo_show();
        let out = parse(&show, "balcony sparkly");
        assert!(out.intents.is_empty());
        assert_eq!(out.unknown.len(), 1);
    }

    #[test]
    fn blackout_and_center_spelling() {
        let show = demo_show();
        let out = parse(&show, "blackout");
        assert_eq!(out.intents[0], Intent { target: "all".into(), actions: vec![Action::Off] });
        let out = parse(&show, "movers to center stage, warm white");
        assert_eq!(out.intents[0].actions[0], Action::Position("Centre Stage".into()));
        assert_eq!(out.intents[1].actions[0], Action::Color("warm white".into()));
    }
}
