//! Prompt for the LLM scene builder. The model gets the show's vocabulary and
//! must answer with JSON that deserialises into `ParseOutput` — the same
//! structure the offline parser produces, so both paths share `resolve`.

use crate::lighting::color::COLOR_NAMES;
use crate::lighting::Attr;
use crate::show::Show;

pub fn system_prompt(show: &Show) -> String {
    let mut s = String::new();
    s.push_str(
        "You turn a lighting operator's plain-language request into JSON commands for a church/event lighting rig.\n\
         Only use the groups, fixtures, position presets and colors listed below. Never invent DMX values.\n\
         If part of the request can't be done with this rig, put that phrase in \"unknown\".\n\n",
    );
    s.push_str("GROUPS (name: aliases — fixture capabilities):\n");
    for g in &show.groups {
        let mut caps: Vec<&str> = Vec::new();
        for id in &g.fixtures {
            if let Some(p) = show.fixture_profile(*id) {
                if p.has_rgb() || !p.color_wheel.is_empty() {
                    caps.push("color");
                }
                if p.has(&Attr::Gobo) {
                    caps.push("gobo");
                }
                if p.is_moving() {
                    caps.push("position");
                }
            }
        }
        caps.sort();
        caps.dedup();
        let gobos = g
            .fixtures
            .iter()
            .filter_map(|id| show.fixture_profile(*id))
            .map(|p| p.gobo_slots.len().saturating_sub(1))
            .max()
            .unwrap_or(0);
        s.push_str(&format!(
            "- {}: {} — {} fixtures; intensity{}{}\n",
            g.name,
            if g.aliases.is_empty() { "-".into() } else { g.aliases.join(", ") },
            g.fixtures.len(),
            if caps.is_empty() { String::new() } else { format!(", {}", caps.join(", ")) },
            if gobos > 0 { format!(" (gobos 1-{gobos}, 0 = open)") } else { String::new() }
        ));
    }
    s.push_str("\nPOSITION PRESETS: ");
    s.push_str(&show.positions.iter().map(|p| p.name.clone()).collect::<Vec<_>>().join(", "));
    s.push_str("\nCOLORS: ");
    s.push_str(&COLOR_NAMES.iter().map(|(n, _)| *n).collect::<Vec<_>>().join(", "));
    s.push_str(", or any hex like #ff8800\n\n");
    s.push_str(
        "Reply with ONLY this JSON, no prose:\n\
         {\"intents\":[{\"target\":\"<group name or 'all'>\",\"actions\":[\n\
           {\"type\":\"intensity\",\"value\":<0-100>} | {\"type\":\"color\",\"value\":\"<color>\"} |\n\
           {\"type\":\"gobo\",\"value\":<n>} | {\"type\":\"position\",\"value\":\"<preset>\"} | {\"type\":\"off\"}\n\
         ]}],\"unknown\":[\"<phrases you couldn't map>\"]}\n",
    );
    s
}

#[cfg(test)]
mod tests {
    #[test]
    fn mentions_groups() {
        let p = super::system_prompt(&crate::demo::demo_show());
        assert!(p.contains("Back Wall"));
        assert!(p.contains("Centre Stage"));
        assert!(p.contains("gobo"));
    }
}
