//! Allen & Heath SQ and Avantis — MIDI messages over TCP port 51325.
//!
//! VERIFY: the parameter numbers below follow the published A&H protocol
//! documents (SQ MIDI Protocol, Avantis MIDI TCP/IP Protocol) as best known,
//! but must be checked against the current PDFs and a real desk before a
//! service. Keep every table in this file so there's one place to fix.

use super::{MixerCommand, MixerKind, MixerProfile, Transport};

const TCP_PORT: u16 = 51325;

fn nrpn(ch: u8, msb: u8, lsb: u8, value_coarse: u8, value_fine: u8) -> Vec<u8> {
    let b = 0xB0 | (ch & 0x0F);
    vec![b, 0x63, msb & 0x7F, b, 0x62, lsb & 0x7F, b, 0x06, value_coarse & 0x7F, b, 0x26, value_fine & 0x7F]
}

/// Scene recall: bank select (CC 0) + program change, scene numbers 1-based.
fn scene_recall(ch: u8, scene: u16) -> Vec<u8> {
    let s = scene.saturating_sub(1);
    vec![0xB0 | (ch & 0x0F), 0x00, ((s >> 7) & 0x7F) as u8, 0xC0 | (ch & 0x0F), (s & 0x7F) as u8]
}

/// SQ-5/6/7. `midi_channel` is 1-16 as set on the desk (Utility > Control > MIDI).
pub struct Sq {
    ch: u8,
}

impl Sq {
    pub fn new(midi_channel: u8) -> Self {
        Self { ch: midi_channel.clamp(1, 16) - 1 }
    }
}

// SQ NRPN map (VERIFY):
//   Input n mute (to LR):  MSB 0x00, LSB 0x00 + (n-1); value fine 1 = muted, 0 = unmuted
//   Input n level to LR:   MSB 0x40, LSB 0x00 + (n-1); 14-bit value (linear taper setting)
//   LR main level:         MSB 0x4F, LSB 0x00
const SQ_MUTE_INPUT_MSB: u8 = 0x00;
const SQ_LEVEL_INPUT_TO_LR_MSB: u8 = 0x40;
const SQ_LEVEL_LR_MSB: u8 = 0x4F;

fn fourteen_bit(level: f32) -> (u8, u8) {
    let v = (level.clamp(0.0, 1.0) * 16383.0).round() as u16;
    (((v >> 7) & 0x7F) as u8, (v & 0x7F) as u8)
}

impl MixerProfile for Sq {
    fn kind(&self) -> MixerKind {
        MixerKind::Sq
    }
    fn transport(&self) -> Transport {
        Transport::Tcp(TCP_PORT)
    }
    fn input_channels(&self) -> u8 {
        48
    }
    fn encode(&self, cmd: &MixerCommand) -> Vec<Vec<u8>> {
        let Some(cmd) = cmd.basic() else { return vec![] };
        match &cmd {
            MixerCommand::Mute { channel, muted } => {
                let lsb = channel.saturating_sub(1);
                vec![nrpn(self.ch, SQ_MUTE_INPUT_MSB, lsb, 0, if *muted { 1 } else { 0 })]
            }
            MixerCommand::Fader { channel, level } => {
                let (vc, vf) = fourteen_bit(*level);
                vec![nrpn(self.ch, SQ_LEVEL_INPUT_TO_LR_MSB, channel.saturating_sub(1), vc, vf)]
            }
            MixerCommand::MainFader { level } => {
                let (vc, vf) = fourteen_bit(*level);
                vec![nrpn(self.ch, SQ_LEVEL_LR_MSB, 0x00, vc, vf)]
            }
            MixerCommand::RecallScene { scene } => vec![scene_recall(self.ch, *scene)],
            MixerCommand::Channel { .. } | MixerCommand::QueryChannel { .. } => vec![],
        }
    }
}

/// Avantis (firmware 2.0+). Uses a base MIDI channel N; inputs are on N,
/// other channel types on N+1..N+4 (not used yet).
pub struct Avantis {
    base: u8,
}

impl Avantis {
    pub fn new(base_midi_channel: u8) -> Self {
        Self { base: base_midi_channel.clamp(1, 12) - 1 }
    }
}

// Avantis map (VERIFY):
//   Input mute:  Note On  9N, CH, 7F (mute on) / 3F (mute off), followed by 9N, CH, 00
//   Input fader: NRPN-style BN 63 CH, BN 62 17, BN 06 LV   (LV 0..7F)
//   Main fader:  inputs only for now — mains live on a different channel-type offset
const AVANTIS_FADER_PARAM: u8 = 0x17;

impl MixerProfile for Avantis {
    fn kind(&self) -> MixerKind {
        MixerKind::Avantis
    }
    fn transport(&self) -> Transport {
        Transport::Tcp(TCP_PORT)
    }
    fn input_channels(&self) -> u8 {
        64
    }
    fn encode(&self, cmd: &MixerCommand) -> Vec<Vec<u8>> {
        let n = self.base & 0x0F;
        let Some(cmd) = cmd.basic() else { return vec![] };
        match &cmd {
            MixerCommand::Mute { channel, muted } => {
                let c = channel.saturating_sub(1) & 0x7F;
                vec![vec![0x90 | n, c, if *muted { 0x7F } else { 0x3F }, 0x90 | n, c, 0x00]]
            }
            MixerCommand::Fader { channel, level } => {
                let c = channel.saturating_sub(1) & 0x7F;
                let lv = (level.clamp(0.0, 1.0) * 127.0).round() as u8;
                let b = 0xB0 | n;
                vec![vec![b, 0x63, c, b, 0x62, AVANTIS_FADER_PARAM, b, 0x06, lv]]
            }
            MixerCommand::MainFader { .. } => vec![], // TODO: main LR channel-type offset
            MixerCommand::RecallScene { scene } => vec![scene_recall(n, *scene)],
            MixerCommand::Channel { .. } | MixerCommand::QueryChannel { .. } => vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_view_fader_and_mute_reach_ah_desks() {
        use crate::mixer::ChannelParam;
        let sq = Sq::new(1);
        let a = sq.encode(&MixerCommand::Channel { channel: 2, param: ChannelParam::Mute { muted: true } });
        assert_eq!(a, sq.encode(&MixerCommand::Mute { channel: 2, muted: true }));
        assert!(!a.is_empty());
        let av = Avantis::new(1);
        let f = av.encode(&MixerCommand::Channel { channel: 3, param: ChannelParam::Fader { level: 0.5 } });
        assert_eq!(f, av.encode(&MixerCommand::Fader { channel: 3, level: 0.5 }));
        // EQ isn't in A&H's public MIDI protocol: nothing is sent.
        assert!(av.encode(&MixerCommand::Channel { channel: 3, param: ChannelParam::EqOn { on: true } }).is_empty());
        assert!(av.encode(&MixerCommand::QueryChannel { channel: 3 }).is_empty());
    }

    #[test]
    fn sq_scene_recall_bank_and_program() {
        let sq = Sq::new(1);
        assert_eq!(sq.encode(&MixerCommand::RecallScene { scene: 1 })[0], vec![0xB0, 0x00, 0x00, 0xC0, 0x00]);
        assert_eq!(sq.encode(&MixerCommand::RecallScene { scene: 130 })[0], vec![0xB0, 0x00, 0x01, 0xC0, 0x01]);
    }

    #[test]
    fn sq_mute_is_nrpn() {
        let m = Sq::new(1).encode(&MixerCommand::Mute { channel: 2, muted: true });
        assert_eq!(m[0], vec![0xB0, 0x63, 0x00, 0xB0, 0x62, 0x01, 0xB0, 0x06, 0x00, 0xB0, 0x26, 0x01]);
    }

    #[test]
    fn avantis_mute_note() {
        let m = Avantis::new(1).encode(&MixerCommand::Mute { channel: 1, muted: false });
        assert_eq!(m[0], vec![0x90, 0x00, 0x3F, 0x90, 0x00, 0x00]);
        assert!(Avantis::new(1).encode(&MixerCommand::MainFader { level: 1.0 }).is_empty());
    }
}
