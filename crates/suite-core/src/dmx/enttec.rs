//! Enttec USB DMX interfaces.
//!
//! **DMX USB Pro** (and compatibles such as DMXking ultraDMX Micro): the widget
//! has its own microcontroller, the host just sends framed messages over the
//! virtual serial port. Rock-solid timing. This is the recommended USB option.
//!
//! **Open DMX USB**: a bare FTDI chip. The host has to produce the DMX signal
//! itself: 250 kbaud, 8 data bits, 2 stop bits, no parity, then for every
//! frame a BREAK (>= 92 µs), a MARK-AFTER-BREAK (>= 12 µs), then start code 0
//! + 512 slots. Desktop OS scheduling makes this jittery, so treat it as
//! best-effort. The serial driver lives in the desktop app
//! (`apps/desktop/src-tauri/src/usb_dmx.rs`).

pub const PRO_START: u8 = 0x7E;
pub const PRO_END: u8 = 0xE7;
pub const PRO_LABEL_SEND_DMX: u8 = 6;
pub const PRO_LABEL_GET_SERIAL: u8 = 10;

pub const OPEN_DMX_BAUD: u32 = 250_000;
pub const OPEN_DMX_BREAK_US: u64 = 110;
pub const OPEN_DMX_MAB_US: u64 = 16;

/// Frame an Enttec Pro "Output Only Send DMX Packet" (label 6).
pub fn pro_dmx_frame(data: &[u8]) -> Vec<u8> {
    let slots = data.len().min(512);
    let len = (slots + 1) as u16; // + start code
    let mut f = Vec::with_capacity(slots + 6);
    f.push(PRO_START);
    f.push(PRO_LABEL_SEND_DMX);
    f.push((len & 0xFF) as u8);
    f.push((len >> 8) as u8);
    f.push(0); // DMX start code
    f.extend_from_slice(&data[..slots]);
    f.push(PRO_END);
    f
}

/// Request the widget serial number (label 10) — handy for auto-detecting a Pro.
pub fn pro_get_serial_frame() -> Vec<u8> {
    vec![PRO_START, PRO_LABEL_GET_SERIAL, 0, 0, PRO_END]
}

/// The bytes sent after the break on an Open DMX: start code + slots.
pub fn open_dmx_payload(data: &[u8]) -> Vec<u8> {
    let mut f = Vec::with_capacity(513);
    f.push(0);
    f.extend((0..512).map(|i| *data.get(i).unwrap_or(&0)));
    f
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pro_frame() {
        let data = vec![1u8; 512];
        let f = pro_dmx_frame(&data);
        assert_eq!(f[0], 0x7E);
        assert_eq!(f[1], 6);
        assert_eq!(u16::from_le_bytes([f[2], f[3]]), 513);
        assert_eq!(f[4], 0);
        assert_eq!(*f.last().unwrap(), 0xE7);
        assert_eq!(f.len(), 518);
        assert_eq!(open_dmx_payload(&[9]).len(), 513);
    }
}
