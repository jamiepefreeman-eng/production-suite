//! Mixer control profiles.
//!
//! | Profile | Transport | Notes |
//! |---|---|---|
//! | Midas M32 / Behringer X32 | OSC over UDP 10023 | `/xremote` every <10 s for feedback |
//! | Behringer X Air (XR18/XR16/XR12, MR18) | OSC over UDP 10024 | X32-like address map |
//! | Allen & Heath SQ (5/6/7) | MIDI over TCP 51325 (or USB MIDI) | NRPN parameters |
//! | Allen & Heath Avantis (fw 2.0+) | MIDI over TCP 51325 | base MIDI channel + offsets per channel type |
//!
//! Every profile turns a [`MixerCommand`] into raw packets. The transport in
//! [`connection`] is shared. Parameter tables marked `VERIFY` must be checked
//! against the manufacturer protocol PDFs on real hardware before a service.

pub mod allen_heath;
pub mod behringer;
pub mod connection;
pub mod osc;
pub mod processing;

pub use processing::{ChannelParam, ChannelUpdate, EqType};

use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum MixerKind {
    X32,
    XAir,
    Sq,
    Avantis,
}

impl MixerKind {
    pub const ALL: [MixerKind; 4] = [MixerKind::X32, MixerKind::XAir, MixerKind::Sq, MixerKind::Avantis];

    pub fn label(&self) -> &'static str {
        match self {
            MixerKind::X32 => "Midas M32 / Behringer X32",
            MixerKind::XAir => "Behringer X Air (XR18/XR16/XR12)",
            MixerKind::Sq => "Allen & Heath SQ-5/6/7",
            MixerKind::Avantis => "Allen & Heath Avantis",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MixerConfig {
    pub kind: MixerKind,
    pub ip: String,
    /// A&H only: the desk's MIDI channel (1-16). SQ default 1; Avantis base channel.
    pub midi_channel: u8,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "type", rename_all = "snake_case"))]
pub enum MixerCommand {
    /// Input channel fader to main mix, `level` 0..1 of fader travel.
    Fader { channel: u8, level: f32 },
    Mute { channel: u8, muted: bool },
    MainFader { level: f32 },
    /// Scene / snapshot number as shown on the desk (1-based).
    RecallScene { scene: u16 },
    /// Any per-channel setting (EQ, gate, compressor, pan, name, fader, mute).
    Channel { channel: u8, param: ChannelParam },
    /// Ask the desk for every setting of one channel; answers arrive as feedback.
    QueryChannel { channel: u8 },
}

impl MixerCommand {
    /// The fader/mute subset every desk understands, for profiles without
    /// processing control (`Channel { Fader | Mute }` -> `Fader` / `Mute`).
    pub fn basic(&self) -> Option<MixerCommand> {
        match self {
            MixerCommand::Channel { channel, param: ChannelParam::Fader { level } } => {
                Some(MixerCommand::Fader { channel: *channel, level: *level })
            }
            MixerCommand::Channel { channel, param: ChannelParam::Mute { muted } } => {
                Some(MixerCommand::Mute { channel: *channel, muted: *muted })
            }
            MixerCommand::Channel { .. } | MixerCommand::QueryChannel { .. } => None,
            other => Some(other.clone()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Udp(u16),
    Tcp(u16),
}

pub trait MixerProfile: Send {
    fn kind(&self) -> MixerKind;
    fn transport(&self) -> Transport;
    fn input_channels(&self) -> u8;
    /// Encode one command. Empty = not supported on this desk.
    fn encode(&self, cmd: &MixerCommand) -> Vec<Vec<u8>>;
    /// Packet to send periodically to keep feedback/connection alive.
    fn keepalive(&self) -> Option<(Vec<u8>, Duration)> {
        None
    }
    /// EQ / gate / compressor control and read-back available.
    fn supports_processing(&self) -> bool {
        false
    }
    /// Turn an OSC message from the desk into a typed channel setting.
    fn decode(&self, _address: &str, _args: &[osc::OscArg]) -> Option<ChannelUpdate> {
        None
    }
}

pub fn profile_for(cfg: &MixerConfig) -> Box<dyn MixerProfile> {
    match cfg.kind {
        MixerKind::X32 => Box::new(behringer::X32),
        MixerKind::XAir => Box::new(behringer::XAir),
        MixerKind::Sq => Box::new(allen_heath::Sq::new(cfg.midi_channel)),
        MixerKind::Avantis => Box::new(allen_heath::Avantis::new(cfg.midi_channel)),
    }
}
