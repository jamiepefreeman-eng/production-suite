//! MIDI controllers (APC, Launchpad, nanoKONTROL, a keyboard…) driving Lighting's
//! show page. The desktop app reads the raw bytes from the OS (midir) and sends
//! them here; mapping a button or fader to a show-page item happens in the engine.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "type", rename_all = "snake_case"))]
pub enum MidiMessage {
    /// Channel 1..16.
    NoteOn { channel: u8, note: u8, velocity: u8 },
    NoteOff { channel: u8, note: u8 },
    ControlChange { channel: u8, controller: u8, value: u8 },
}

impl MidiMessage {
    /// Parse one raw message. Note-on with velocity 0 is a note-off (running status
    /// and system messages are ignored).
    pub fn parse(bytes: &[u8]) -> Option<MidiMessage> {
        let (&status, rest) = bytes.split_first()?;
        let channel = (status & 0x0f) + 1;
        match (status & 0xf0, rest) {
            (0x90, [note, vel, ..]) if *vel > 0 => Some(MidiMessage::NoteOn { channel, note: *note & 0x7f, velocity: *vel & 0x7f }),
            (0x90, [note, _, ..]) | (0x80, [note, _, ..]) => Some(MidiMessage::NoteOff { channel, note: *note & 0x7f }),
            (0xb0, [cc, val, ..]) => Some(MidiMessage::ControlChange { channel, controller: *cc & 0x7f, value: *val & 0x7f }),
            _ => None,
        }
    }

    /// The physical control this came from.
    pub fn control(&self) -> MidiControl {
        match *self {
            MidiMessage::NoteOn { channel, note, .. } | MidiMessage::NoteOff { channel, note } => MidiControl { kind: MidiControlKind::Note, channel, number: note },
            MidiMessage::ControlChange { channel, controller, .. } => MidiControl { kind: MidiControlKind::Cc, channel, number: controller },
        }
    }

    /// 0..1: velocity / CC value; note-off = 0.
    pub fn value(&self) -> f32 {
        match *self {
            MidiMessage::NoteOn { velocity, .. } => velocity as f32 / 127.0,
            MidiMessage::NoteOff { .. } => 0.0,
            MidiMessage::ControlChange { value, .. } => value as f32 / 127.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum MidiControlKind {
    #[default]
    Note,
    Cc,
}

/// A button / pad (note) or knob / fader (CC) on a controller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MidiControl {
    pub kind: MidiControlKind,
    pub channel: u8,
    pub number: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_notes_and_ccs() {
        assert_eq!(MidiMessage::parse(&[0x90, 60, 100]), Some(MidiMessage::NoteOn { channel: 1, note: 60, velocity: 100 }));
        assert_eq!(MidiMessage::parse(&[0x91, 60, 0]), Some(MidiMessage::NoteOff { channel: 2, note: 60 }));
        assert_eq!(MidiMessage::parse(&[0x80, 61, 40]), Some(MidiMessage::NoteOff { channel: 1, note: 61 }));
        assert_eq!(MidiMessage::parse(&[0xB0, 7, 127]), Some(MidiMessage::ControlChange { channel: 1, controller: 7, value: 127 }));
        assert_eq!(MidiMessage::parse(&[0xF8]), None); // clock
        assert_eq!(MidiMessage::parse(&[0x90, 60]), None); // short
        let cc = MidiMessage::parse(&[0xB3, 20, 64]).unwrap();
        assert_eq!(cc.control(), MidiControl { kind: MidiControlKind::Cc, channel: 4, number: 20 });
        assert!((cc.value() - 64.0 / 127.0).abs() < 1e-6);
    }
}
