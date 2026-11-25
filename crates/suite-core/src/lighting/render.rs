//! Look -> DMX (for output) and DMX -> visual state (for the Visualizer).
//!
//! Because the Visualizer works from DMX rather than from the look, it shows
//! exactly what the rig receives — and it can also show DMX arriving from an
//! external console (e.g. Lightkey over sACN/Art-Net).

use super::{Attr, FixtureProfile, Look, Rgb};
use crate::dmx::DmxFrame;
use crate::show::Show;

const WHITE: Rgb = Rgb::new(1.0, 1.0, 1.0);

fn to_byte(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn put(frame: &mut DmxFrame, universe: u16, base: u16, profile: &FixtureProfile, attr: Attr, value: u8) {
    if let Some(off) = profile.offset(&attr) {
        frame.set(universe, base + off, value);
    }
}

fn put16(frame: &mut DmxFrame, universe: u16, base: u16, profile: &FixtureProfile, coarse: Attr, fine: Attr, v: f32) {
    let v = (v.clamp(0.0, 1.0) * 65535.0).round() as u16;
    put(frame, universe, base, profile, coarse, (v >> 8) as u8);
    put(frame, universe, base, profile, fine, (v & 0xFF) as u8);
}

pub fn render_look(show: &Show, look: &Look) -> DmxFrame {
    let mut frame = DmxFrame::default();
    for fx in &show.fixtures {
        let Some(p) = show.profile(&fx.profile_id) else { continue };
        let (u, base) = (fx.universe, fx.address);
        // Defaults first.
        for (i, ch) in p.channels.iter().enumerate() {
            frame.set(u, base + i as u16, ch.default);
        }
        let st = look.fixtures.get(&fx.id).cloned().unwrap_or_default();
        let intensity = st.intensity.unwrap_or(0.0).clamp(0.0, 1.0);
        let color = st.color.unwrap_or(WHITE);
        let has_dimmer = p.has(&Attr::Dimmer);

        if has_dimmer {
            put(&mut frame, u, base, p, Attr::Dimmer, to_byte(intensity));
        }
        if p.has_rgb() {
            let scale = if has_dimmer { 1.0 } else { intensity };
            let (mut r, mut g, mut b) = (color.r, color.g, color.b);
            if p.has(&Attr::White) {
                let w = r.min(g).min(b);
                r -= w;
                g -= w;
                b -= w;
                put(&mut frame, u, base, p, Attr::White, to_byte(w * scale));
            }
            put(&mut frame, u, base, p, Attr::Red, to_byte(r * scale));
            put(&mut frame, u, base, p, Attr::Green, to_byte(g * scale));
            put(&mut frame, u, base, p, Attr::Blue, to_byte(b * scale));
        } else if p.has_cmy() {
            // Subtractive mixing: cyan filters red, etc. Brightness comes from the dimmer.
            put(&mut frame, u, base, p, Attr::Cyan, to_byte(1.0 - color.r));
            put(&mut frame, u, base, p, Attr::Magenta, to_byte(1.0 - color.g));
            put(&mut frame, u, base, p, Attr::Yellow, to_byte(1.0 - color.b));
        } else if !p.color_wheel.is_empty() {
            if let Some(slot) = p
                .color_wheel
                .iter()
                .min_by(|a, b| a.rgb.distance(&color).total_cmp(&b.rgb.distance(&color)))
            {
                put(&mut frame, u, base, p, Attr::ColorWheel, slot.dmx);
            }
        }
        if let Some(g) = st.gobo {
            if let Some(v) = p.gobo_slots.get(g as usize) {
                put(&mut frame, u, base, p, Attr::Gobo, *v);
            }
        }
        if let Some(pan) = st.pan {
            put16(&mut frame, u, base, p, Attr::Pan, Attr::PanFine, pan);
        }
        if let Some(tilt) = st.tilt {
            put16(&mut frame, u, base, p, Attr::Tilt, Attr::TiltFine, tilt);
        }
    }
    frame
}

/// What the Visualizer needs to draw one fixture.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FixtureVisual {
    pub id: u32,
    pub intensity: f32,
    pub color: Rgb,
    pub pan: f32,
    pub tilt: f32,
    pub gobo: u8,
}

fn get(frame: &DmxFrame, u: u16, base: u16, p: &FixtureProfile, attr: Attr) -> Option<u8> {
    p.offset(&attr).map(|o| frame.get(u, base + o))
}

pub fn decode_visuals(show: &Show, frame: &DmxFrame) -> Vec<FixtureVisual> {
    let mut out = Vec::with_capacity(show.fixtures.len());
    for fx in &show.fixtures {
        let Some(p) = show.profile(&fx.profile_id) else { continue };
        let (u, base) = (fx.universe, fx.address);
        let f = |a: Attr| get(frame, u, base, p, a).map(|v| v as f32 / 255.0);
        let w = f(Attr::White).unwrap_or(0.0);
        let mut color = if p.has_rgb() {
            Rgb::new(
                f(Attr::Red).unwrap_or(0.0) + w,
                f(Attr::Green).unwrap_or(0.0) + w,
                f(Attr::Blue).unwrap_or(0.0) + w,
            )
        } else if p.has_cmy() {
            Rgb::new(1.0 - f(Attr::Cyan).unwrap_or(0.0), 1.0 - f(Attr::Magenta).unwrap_or(0.0), 1.0 - f(Attr::Yellow).unwrap_or(0.0))
        } else if let Some(cw) = get(frame, u, base, p, Attr::ColorWheel) {
            p.color_wheel
                .iter()
                .min_by_key(|s| (s.dmx as i16 - cw as i16).abs())
                .map(|s| s.rgb)
                .unwrap_or(WHITE)
        } else {
            WHITE
        };
        let intensity = match f(Attr::Dimmer) {
            Some(d) => d,
            None => {
                // RGB-only fixture: brightness lives in the color channels.
                let m = color.r.max(color.g).max(color.b);
                if m > 0.0 {
                    color = Rgb::new(color.r / m, color.g / m, color.b / m);
                }
                m.min(1.0)
            }
        };
        let pt = |c: Attr, fi: Attr| -> f32 {
            match (get(frame, u, base, p, c), get(frame, u, base, p, fi)) {
                (Some(hi), Some(lo)) => ((hi as u16) << 8 | lo as u16) as f32 / 65535.0,
                (Some(hi), None) => hi as f32 / 255.0,
                _ => 0.5,
            }
        };
        let gobo_val = get(frame, u, base, p, Attr::Gobo).unwrap_or(0);
        let gobo = p
            .gobo_slots
            .iter()
            .enumerate()
            .min_by_key(|(_, v)| (**v as i16 - gobo_val as i16).abs())
            .map(|(i, _)| i as u8)
            .unwrap_or(0);
        out.push(FixtureVisual {
            id: fx.id,
            intensity,
            color: Rgb::new(color.r.min(1.0), color.g.min(1.0), color.b.min(1.0)),
            pan: pt(Attr::Pan, Attr::PanFine),
            tilt: pt(Attr::Tilt, Attr::TiltFine),
            gobo,
        });
    }
    out
}

#[cfg(test)]
mod cmy_tests {
    use super::*;
    use crate::lighting::{ChannelDef, Fixture, FixtureKind, FixtureState};

    /// Subtractive colour: red light = no cyan, full magenta and yellow — and it decodes back.
    #[test]
    fn cmy_fixture_mixes_and_decodes() {
        let ch = |attr| ChannelDef { attr, default: 0, name: String::new() };
        let mut show = Show::default();
        show.profiles.push(FixtureProfile {
            id: "cmy".into(),
            manufacturer: "T".into(),
            model: "CMY Spot".into(),
            mode: "4ch".into(),
            kind: FixtureKind::MovingSpot,
            channels: vec![ch(Attr::Dimmer), ch(Attr::Cyan), ch(Attr::Magenta), ch(Attr::Yellow)],
            gobo_slots: vec![],
            color_wheel: vec![],
            pan_range: 0.0,
            tilt_range: 0.0,
            beam_angle: 20.0,
            needs_verification: false,
        });
        show.fixtures.push(Fixture { id: 1, name: "A".into(), profile_id: "cmy".into(), universe: 1, address: 10, position: [0.0; 3], rotation: [0.0; 3] });
        let mut look = Look::default();
        *look.state_mut(1) = FixtureState { intensity: Some(1.0), color: Some(Rgb::new(1.0, 0.0, 0.0)), ..Default::default() };
        let frame = render_look(&show, &look);
        assert_eq!([frame.get(1, 10), frame.get(1, 11), frame.get(1, 12), frame.get(1, 13)], [255, 0, 255, 255]);
        let v = &decode_visuals(&show, &frame)[0];
        assert_eq!((v.color.r, v.color.g, v.color.b), (1.0, 0.0, 0.0));
    }
}
