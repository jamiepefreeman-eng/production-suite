//! Deterministic intent -> look resolution, validated against the patch.

use super::intent::{Action, Intent};
use crate::lighting::{Attr, Look, Rgb};
use crate::show::Show;

#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Resolution {
    /// Only the fixtures/attributes the sentence touched. Layer it over the
    /// programmer (or a cue) with `Look::merged`.
    pub look: Look,
    /// Human-readable summary: "Back Wall (13): color blue".
    pub applied: Vec<String>,
    /// Anything that couldn't be applied, and why.
    pub issues: Vec<String>,
}

fn eq(a: &str, b: &str) -> bool {
    let n = |s: &str| s.trim().to_lowercase().replace("center", "centre");
    n(a) == n(b)
}

pub fn target_fixtures(show: &Show, target: &str) -> Option<(String, Vec<u32>)> {
    if eq(target, "all") || eq(target, "everything") {
        return Some(("All".into(), show.fixtures.iter().map(|f| f.id).collect()));
    }
    if let Some(g) = show
        .groups
        .iter()
        .find(|g| eq(&g.name, target) || g.aliases.iter().any(|a| eq(a, target)))
    {
        return Some((g.name.clone(), g.fixtures.clone()));
    }
    show.fixtures
        .iter()
        .find(|f| eq(&f.name, target))
        .map(|f| (f.name.clone(), vec![f.id]))
}

/// `base` is the look the result will be layered on (usually the programmer),
/// used to decide whether a color change also needs to bring intensity up.
pub fn resolve(show: &Show, intents: &[Intent], base: &Look) -> Resolution {
    let mut res = Resolution::default();
    for intent in intents {
        let Some((label, ids)) = target_fixtures(show, &intent.target) else {
            res.issues.push(format!("No group or fixture called '{}'", intent.target));
            continue;
        };
        let mut done: Vec<String> = Vec::new();
        for action in &intent.actions {
            match action {
                Action::Intensity(p) => {
                    for id in &ids {
                        res.look.state_mut(*id).intensity = Some((p / 100.0).clamp(0.0, 1.0));
                    }
                    done.push(format!("{p:.0}%"));
                }
                Action::Off => {
                    for id in &ids {
                        res.look.state_mut(*id).intensity = Some(0.0);
                    }
                    done.push("off".into());
                }
                Action::Color(name) => {
                    let Some(rgb) = Rgb::parse(name) else {
                        res.issues.push(format!("Unknown color '{name}'"));
                        continue;
                    };
                    let mut skipped = 0;
                    for id in &ids {
                        let Some(p) = show.fixture_profile(*id) else { continue };
                        if !p.has_rgb() && p.color_wheel.is_empty() {
                            skipped += 1;
                            continue;
                        }
                        let already_on = res.look.fixtures.get(id).and_then(|s| s.intensity).is_some()
                            || base.fixtures.get(id).and_then(|s| s.intensity).is_some_and(|i| i > 0.0);
                        let st = res.look.state_mut(*id);
                        st.color = Some(rgb);
                        if !already_on {
                            st.intensity = Some(1.0); // "back wall blue" means turn them on, blue
                        }
                    }
                    if skipped > 0 {
                        res.issues.push(format!("{skipped} fixture(s) in {label} can't change color"));
                    }
                    done.push(format!("color {name}"));
                }
                Action::Gobo(n) => {
                    let mut ok = 0;
                    for id in &ids {
                        let Some(p) = show.fixture_profile(*id) else { continue };
                        if !p.has(&Attr::Gobo) {
                            continue;
                        }
                        if (*n as usize) >= p.gobo_slots.len() {
                            res.issues.push(format!("{} has no gobo {n}", p.model));
                            continue;
                        }
                        res.look.state_mut(*id).gobo = Some(*n);
                        ok += 1;
                    }
                    if ok == 0 {
                        res.issues.push(format!("Nothing in {label} has a gobo wheel"));
                    } else {
                        done.push(format!("gobo {n}"));
                    }
                }
                Action::Position(name) => {
                    let Some(preset) = show
                        .positions
                        .iter()
                        .find(|p| eq(&p.name, name) || p.aliases.iter().any(|a| eq(a, name)))
                    else {
                        res.issues.push(format!("No position preset called '{name}'"));
                        continue;
                    };
                    let mut missing = 0;
                    for id in &ids {
                        if !show.fixture_profile(*id).is_some_and(|p| p.is_moving()) {
                            continue;
                        }
                        match preset.values.iter().find(|v| v.fixture == *id) {
                            Some(v) => {
                                let st = res.look.state_mut(*id);
                                st.pan = Some(v.pan);
                                st.tilt = Some(v.tilt);
                            }
                            None => missing += 1,
                        }
                    }
                    if missing > 0 {
                        res.issues.push(format!(
                            "{missing} fixture(s) in {label} have no stored focus for '{}' — record it in Lighting > Positions",
                            preset.name
                        ));
                    }
                    done.push(format!("position {}", preset.name));
                }
            }
        }
        if !done.is_empty() {
            res.applied.push(format!("{label} ({}): {}", ids.len(), done.join(", ")));
        }
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::parse;
    use crate::demo::demo_show;
    use crate::lighting::render_look;

    #[test]
    fn example_sentence_to_dmx() {
        let show = demo_show();
        let parsed = parse(&show, "back wall blue, front spots on at 75, movers gobo 3 location centre stage");
        let res = resolve(&show, &parsed.intents, &Look::default());
        assert!(res.issues.is_empty(), "{:?}", res.issues);
        assert_eq!(res.applied.len(), 3);

        let frame = render_look(&show, &res.look);
        // First back-wall curtain: dimmer full, blue full, red/green zero.
        let curtain = show.fixtures.iter().find(|f| f.profile_id == "mdac-curtain-8ch").unwrap();
        assert_eq!(frame.get(curtain.universe, curtain.address), 255);
        assert_eq!(frame.get(curtain.universe, curtain.address + 1), 0);
        assert_eq!(frame.get(curtain.universe, curtain.address + 3), 255);

        // A mover got gobo 3 and a pan/tilt from the preset.
        let mover = show.fixtures.iter().find(|f| f.profile_id == "chauvet-intimidator-spot-250-13ch").unwrap();
        let p = show.profile(&mover.profile_id).unwrap();
        let gobo_off = p.offset(&Attr::Gobo).unwrap();
        assert_eq!(frame.get(mover.universe, mover.address + gobo_off), p.gobo_slots[3]);
        let st = &res.look.fixtures[&mover.id];
        assert!(st.pan.is_some() && st.tilt.is_some());
    }

    #[test]
    fn rejects_unknown_things() {
        let show = demo_show();
        let res = resolve(
            &show,
            &[Intent { target: "Back Wall".into(), actions: vec![Action::Gobo(2)] }],
            &Look::default(),
        );
        assert!(!res.issues.is_empty());
        assert!(res.look.is_empty());
    }
}
