//! Moving looks the engine plays on top of cues and the programmer:
//! rainbow, chase, pulse and strobe over a group of lights.
//!
//! Effects are pure functions of time, so they are the same in every window and
//! the DMX thread just asks for "the look at time t".

use super::look::{FixtureState, Look};
use super::Rgb;
use crate::show::Show;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum EffectKind {
    /// Colours cycle round the colour wheel, spread across the lights.
    #[default]
    Rainbow,
    /// One light after another lights up, left to right.
    Chase,
    /// Brightness breathes up and down (a wave when `spread` > 0).
    Pulse,
    /// Short flashes.
    Strobe,
    /// Alternates between the effect's two colours.
    TwoColour,
}

impl EffectKind {
    pub const ALL: [EffectKind; 5] = [EffectKind::Rainbow, EffectKind::Chase, EffectKind::Pulse, EffectKind::Strobe, EffectKind::TwoColour];
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default))]
pub struct Effect {
    pub id: u32,
    pub name: String,
    pub kind: EffectKind,
    /// Group name the effect plays on; empty = every light.
    pub group: String,
    pub color: Rgb,
    pub color2: Rgb,
    /// Cycles per second.
    pub speed: f32,
    /// 0 = all lights together, 1 = spread over one full cycle left to right.
    pub spread: f32,
    /// Brightness 0..1.
    pub level: f32,
}

impl Default for Effect {
    fn default() -> Self {
        Effect {
            id: 0,
            name: "Effect".into(),
            kind: EffectKind::Rainbow,
            group: String::new(),
            color: Rgb::new(1.0, 0.0, 0.0),
            color2: Rgb::new(0.0, 0.0, 1.0),
            speed: 0.25,
            spread: 1.0,
            level: 1.0,
        }
    }
}

/// Hue 0..1 → full-saturation colour.
pub fn hue(h: f32) -> Rgb {
    let h = h.rem_euclid(1.0) * 6.0;
    let x = 1.0 - (h % 2.0 - 1.0).abs();
    let (r, g, b) = match h as u32 {
        0 => (1.0, x, 0.0),
        1 => (x, 1.0, 0.0),
        2 => (0.0, 1.0, x),
        3 => (0.0, x, 1.0),
        4 => (x, 0.0, 1.0),
        _ => (1.0, 0.0, x),
    };
    Rgb::new(r, g, b)
}

/// The lights an effect plays on, left to right across the stage.
pub fn effect_fixtures(show: &Show, e: &Effect) -> Vec<u32> {
    let ids: Vec<u32> = if e.group.is_empty() {
        show.fixtures.iter().map(|f| f.id).collect()
    } else {
        show.groups.iter().find(|g| g.name.eq_ignore_ascii_case(&e.group)).map(|g| g.fixtures.clone()).unwrap_or_default()
    };
    let mut fx: Vec<(u32, f32)> = ids.iter().filter_map(|id| show.fixture(*id).map(|f| (*id, f.position[0]))).collect();
    fx.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
    fx.into_iter().map(|(id, _)| id).collect()
}

/// Write the effect's look at `t` seconds into `look` (overrides colour and intensity).
pub fn apply(show: &Show, e: &Effect, t: f32, look: &mut Look) {
    let ids = effect_fixtures(show, e);
    let n = ids.len().max(1) as f32;
    let cycle = t * e.speed.max(0.0);
    for (i, id) in ids.iter().enumerate() {
        let pos = i as f32 / n; // 0..1 left to right
        let phase = (cycle - pos * e.spread).rem_euclid(1.0);
        let (color, level) = match e.kind {
            EffectKind::Rainbow => (hue(phase), 1.0),
            EffectKind::Chase => {
                // The lit "head" moves one light per 1/n of a cycle, with a short tail.
                let head = (cycle.rem_euclid(1.0) * n).floor();
                let d = (head - i as f32).rem_euclid(n);
                (e.color, if d < 1.0 { 1.0 } else if d < 2.0 { 0.3 } else { 0.0 })
            }
            EffectKind::Pulse => (e.color, 0.5 - 0.5 * (phase * std::f32::consts::TAU).cos()),
            EffectKind::Strobe => (e.color, if phase < 0.15 { 1.0 } else { 0.0 }),
            EffectKind::TwoColour => (if phase < 0.5 { e.color } else { e.color2 }, 1.0),
        };
        let st = look.fixtures.entry(*id).or_default();
        *st = FixtureState { intensity: Some(level * e.level.clamp(0.0, 1.0)), color: Some(color), ..st.clone() };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rainbow_spreads_hues_and_chase_lights_one_at_a_time() {
        let show = crate::demo::demo_show();
        let g = show.groups.iter().find(|g| g.fixtures.len() >= 4).unwrap().name.clone();
        let mut e = Effect { group: g.clone(), kind: EffectKind::Rainbow, ..Effect::default() };
        let mut look = Look::default();
        apply(&show, &e, 0.0, &mut look);
        let ids = effect_fixtures(&show, &e);
        assert_eq!(look.fixtures.len(), ids.len());
        assert_ne!(look.fixtures[&ids[0]].color, look.fixtures[&ids[1]].color);

        e.kind = EffectKind::Chase;
        let mut look = Look::default();
        apply(&show, &e, 0.0, &mut look);
        let lit = ids.iter().filter(|id| look.fixtures[id].intensity == Some(1.0)).count();
        assert_eq!(lit, 1);
        // Half a cycle later another light leads.
        let mut later = Look::default();
        apply(&show, &e, 0.5 / e.speed, &mut later);
        assert_ne!(look, later);
    }

    #[test]
    fn hue_wheel_primaries() {
        assert_eq!(hue(0.0), Rgb::new(1.0, 0.0, 0.0));
        assert_eq!(hue(1.0 / 3.0).g, 1.0);
        assert_eq!(hue(2.0 / 3.0).b, 1.0);
    }
}
