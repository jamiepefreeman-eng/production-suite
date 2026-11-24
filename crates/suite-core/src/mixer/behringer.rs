//! Midas M32 / Behringer X32 (UDP 10023) and Behringer X Air (UDP 10024).
//!
//! Both reply to whatever port the request came from, and stream parameter
//! changes back after `/xremote`, which must be renewed within 10 seconds.
//! `/…/mix/on` is 1 = unmuted, 0 = muted. Faders are float 0..1.

use super::osc::{encode, OscArg};
use super::{processing, ChannelUpdate, MixerCommand, MixerKind, MixerProfile, Transport};
use std::time::Duration;

fn ch(n: u8) -> String {
    format!("{:02}", n.max(1))
}

pub struct X32;

impl MixerProfile for X32 {
    fn kind(&self) -> MixerKind {
        MixerKind::X32
    }
    fn transport(&self) -> Transport {
        Transport::Udp(10023)
    }
    fn input_channels(&self) -> u8 {
        32
    }
    fn encode(&self, cmd: &MixerCommand) -> Vec<Vec<u8>> {
        match cmd {
            MixerCommand::Fader { channel, level } => {
                vec![encode(&format!("/ch/{}/mix/fader", ch(*channel)), &[OscArg::Float(level.clamp(0.0, 1.0))])]
            }
            MixerCommand::Mute { channel, muted } => {
                vec![encode(&format!("/ch/{}/mix/on", ch(*channel)), &[OscArg::Int(if *muted { 0 } else { 1 })])]
            }
            MixerCommand::MainFader { level } => {
                vec![encode("/main/st/mix/fader", &[OscArg::Float(level.clamp(0.0, 1.0))])]
            }
            // X32 scenes are 0-based internally (00..99).
            MixerCommand::RecallScene { scene } => {
                vec![encode("/-action/goscene", &[OscArg::Int(scene.saturating_sub(1) as i32)])]
            }
            MixerCommand::Channel { channel, param } => processing::osc_set(*channel, param),
            MixerCommand::QueryChannel { channel } => processing::osc_query(*channel),
        }
    }
    fn keepalive(&self) -> Option<(Vec<u8>, Duration)> {
        Some((encode("/xremote", &[]), Duration::from_secs(8)))
    }
    fn supports_processing(&self) -> bool {
        true
    }
    fn decode(&self, address: &str, args: &[OscArg]) -> Option<ChannelUpdate> {
        processing::osc_decode(address, args)
    }
}

pub struct XAir;

impl MixerProfile for XAir {
    fn kind(&self) -> MixerKind {
        MixerKind::XAir
    }
    fn transport(&self) -> Transport {
        Transport::Udp(10024)
    }
    fn input_channels(&self) -> u8 {
        16
    }
    fn encode(&self, cmd: &MixerCommand) -> Vec<Vec<u8>> {
        match cmd {
            MixerCommand::Fader { channel, level } => {
                vec![encode(&format!("/ch/{}/mix/fader", ch(*channel)), &[OscArg::Float(level.clamp(0.0, 1.0))])]
            }
            MixerCommand::Mute { channel, muted } => {
                vec![encode(&format!("/ch/{}/mix/on", ch(*channel)), &[OscArg::Int(if *muted { 0 } else { 1 })])]
            }
            MixerCommand::MainFader { level } => {
                vec![encode("/lr/mix/fader", &[OscArg::Float(level.clamp(0.0, 1.0))])]
            }
            // X Air snapshots are 1-based (1..64).
            MixerCommand::RecallScene { scene } => {
                vec![encode("/-snap/load", &[OscArg::Int((*scene).max(1) as i32)])]
            }
            MixerCommand::Channel { channel, param } => processing::osc_set(*channel, param),
            MixerCommand::QueryChannel { channel } => processing::osc_query(*channel),
        }
    }
    fn keepalive(&self) -> Option<(Vec<u8>, Duration)> {
        Some((encode("/xremote", &[]), Duration::from_secs(8)))
    }
    fn supports_processing(&self) -> bool {
        true
    }
    fn decode(&self, address: &str, args: &[OscArg]) -> Option<ChannelUpdate> {
        processing::osc_decode(address, args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mixer::osc::decode;

    #[test]
    fn x32_mute_and_scene() {
        let p = X32.encode(&MixerCommand::Mute { channel: 3, muted: true });
        assert_eq!(decode(&p[0]).unwrap(), ("/ch/03/mix/on".into(), vec![OscArg::Int(0)]));
        let p = X32.encode(&MixerCommand::RecallScene { scene: 1 });
        assert_eq!(decode(&p[0]).unwrap(), ("/-action/goscene".into(), vec![OscArg::Int(0)]));
    }

    #[test]
    fn xair_main() {
        let p = XAir.encode(&MixerCommand::MainFader { level: 0.5 });
        assert_eq!(decode(&p[0]).unwrap(), ("/lr/mix/fader".into(), vec![OscArg::Float(0.5)]));
    }
}
