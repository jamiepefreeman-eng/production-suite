//! DMX universes and output protocols.
//!
//! * [`artnet`]  — Art-Net 4 ArtDmx over UDP (send + receive)
//! * [`sacn`]    — ANSI E1.31 streaming ACN over UDP multicast/unicast (send + receive)
//! * [`enttec`]  — Enttec DMX USB Pro framing, and Open DMX timing notes.
//!   The serial port itself lives in the desktop app (needs the `serialport` crate).

pub mod artnet;
pub mod enttec;
pub mod sacn;

use std::collections::BTreeMap;
use std::io;

pub const UNIVERSE_SIZE: usize = 512;

/// One frame of output: universe number -> 512 channel values.
#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct DmxFrame {
    pub universes: BTreeMap<u16, Vec<u8>>,
}

impl DmxFrame {
    pub fn universe_mut(&mut self, u: u16) -> &mut Vec<u8> {
        self.universes.entry(u).or_insert_with(|| vec![0; UNIVERSE_SIZE])
    }

    pub fn get(&self, universe: u16, address: u16) -> u8 {
        if address == 0 || address as usize > UNIVERSE_SIZE {
            return 0;
        }
        self.universes
            .get(&universe)
            .map(|d| d[address as usize - 1])
            .unwrap_or(0)
    }

    /// Set a 1-based DMX address.
    pub fn set(&mut self, universe: u16, address: u16, value: u8) {
        if address == 0 || address as usize > UNIVERSE_SIZE {
            return;
        }
        self.universe_mut(universe)[address as usize - 1] = value;
    }

    /// Linear crossfade between two frames, `t` in 0..=1.
    pub fn lerp(from: &DmxFrame, to: &DmxFrame, t: f32) -> DmxFrame {
        let t = t.clamp(0.0, 1.0);
        let mut out = DmxFrame::default();
        let keys: std::collections::BTreeSet<u16> =
            from.universes.keys().chain(to.universes.keys()).copied().collect();
        for u in keys {
            let zero = vec![0u8; UNIVERSE_SIZE];
            let a = from.universes.get(&u).unwrap_or(&zero);
            let b = to.universes.get(&u).unwrap_or(&zero);
            let data = a
                .iter()
                .zip(b.iter())
                .map(|(&x, &y)| (x as f32 + (y as f32 - x as f32) * t).round() as u8)
                .collect();
            out.universes.insert(u, data);
        }
        out
    }
}

/// Anything that can put a universe on the wire.
pub trait DmxSink: Send {
    fn name(&self) -> String;
    fn send(&mut self, universe: u16, data: &[u8]) -> io::Result<()>;
}

/// Where a show wants its DMX to go. Several can be active at once.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "type", rename_all = "snake_case"))]
pub enum DmxOutputConfig {
    /// Art-Net to a node (or broadcast like 2.255.255.255 / 10.255.255.255).
    ArtNet { ip: String, universe: u16, artnet_universe: u16 },
    /// sACN multicast (or unicast when `unicast_ip` is set). Also feeds the
    /// built-in Visualizer or any external visualizer (Capture etc.).
    Sacn { universe: u16, sacn_universe: u16, priority: u8, unicast_ip: Option<String> },
    /// Enttec DMX USB Pro (and Pro-compatible widgets). Reliable timing.
    EnttecPro { port: String, universe: u16 },
    /// Enttec Open DMX (FTDI "dumb" interface). Host generates timing — best effort.
    OpenDmx { port: String, universe: u16 },
}

impl DmxOutputConfig {
    pub fn show_universe(&self) -> u16 {
        match self {
            Self::ArtNet { universe, .. }
            | Self::Sacn { universe, .. }
            | Self::EnttecPro { universe, .. }
            | Self::OpenDmx { universe, .. } => *universe,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_lerp() {
        let mut a = DmxFrame::default();
        let mut b = DmxFrame::default();
        a.set(1, 1, 0);
        b.set(1, 1, 200);
        b.set(1, 512, 100);
        let mid = DmxFrame::lerp(&a, &b, 0.5);
        assert_eq!(mid.get(1, 1), 100);
        assert_eq!(mid.get(1, 512), 50);
        assert_eq!(mid.get(1, 513), 0);
    }
}
