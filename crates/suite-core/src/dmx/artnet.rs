//! Art-Net 4 ArtDmx (OpCode 0x5000) on UDP port 6454.

use super::{DmxSink, UNIVERSE_SIZE};
use std::io;
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};

pub const PORT: u16 = 6454;
const ID: &[u8; 8] = b"Art-Net\0";
const OP_DMX: u16 = 0x5000;
const PROTOCOL_VERSION: u16 = 14;

/// Build an ArtDmx packet. `port_address` is the 15-bit Net/Sub-Net/Universe.
pub fn build_artdmx(port_address: u16, sequence: u8, data: &[u8]) -> Vec<u8> {
    let mut len = data.len().min(UNIVERSE_SIZE);
    if len % 2 == 1 {
        len += 1; // length must be even
    }
    let len = len.max(2);
    let mut p = Vec::with_capacity(18 + len);
    p.extend_from_slice(ID);
    p.extend_from_slice(&OP_DMX.to_le_bytes());
    p.extend_from_slice(&PROTOCOL_VERSION.to_be_bytes());
    p.push(sequence);
    p.push(0); // physical
    p.push((port_address & 0xFF) as u8); // SubUni
    p.push(((port_address >> 8) & 0x7F) as u8); // Net
    p.extend_from_slice(&(len as u16).to_be_bytes());
    for i in 0..len {
        p.push(*data.get(i).unwrap_or(&0));
    }
    p
}

/// Parse an ArtDmx packet into (port_address, data). Used by the Visualizer
/// when listening to an external console such as Lightkey.
pub fn parse_artdmx(pkt: &[u8]) -> Option<(u16, Vec<u8>)> {
    if pkt.len() < 18 || &pkt[0..8] != ID {
        return None;
    }
    if u16::from_le_bytes([pkt[8], pkt[9]]) != OP_DMX {
        return None;
    }
    let port = (pkt[14] as u16) | ((pkt[15] as u16 & 0x7F) << 8);
    let len = u16::from_be_bytes([pkt[16], pkt[17]]) as usize;
    let end = (18 + len).min(pkt.len());
    let mut data = pkt[18..end].to_vec();
    data.resize(UNIVERSE_SIZE, 0);
    Some((port, data))
}

pub struct ArtNetSender {
    socket: UdpSocket,
    target: SocketAddr,
    port_address: u16,
    sequence: u8,
}

impl ArtNetSender {
    pub fn new(ip: &str, port_address: u16) -> io::Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0")?;
        socket.set_broadcast(true)?;
        let target = (ip, PORT)
            .to_socket_addrs()?
            .next()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "bad Art-Net address"))?;
        Ok(Self { socket, target, port_address, sequence: 1 })
    }
}

impl DmxSink for ArtNetSender {
    fn name(&self) -> String {
        format!("Art-Net {} univ {}", self.target, self.port_address)
    }

    fn send(&mut self, _universe: u16, data: &[u8]) -> io::Result<()> {
        let pkt = build_artdmx(self.port_address, self.sequence, data);
        self.sequence = if self.sequence == 255 { 1 } else { self.sequence + 1 };
        self.socket.send_to(&pkt, self.target).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let mut data = vec![0u8; 512];
        data[0] = 255;
        data[511] = 7;
        let pkt = build_artdmx(0x0102, 5, &data);
        assert_eq!(&pkt[0..8], b"Art-Net\0");
        assert_eq!(pkt[8..10], [0x00, 0x50]);
        assert_eq!(pkt[10..12], [0x00, 14]);
        assert_eq!(pkt[14], 0x02);
        assert_eq!(pkt[15], 0x01);
        assert_eq!(pkt.len(), 18 + 512);
        let (port, back) = parse_artdmx(&pkt).unwrap();
        assert_eq!(port, 0x0102);
        assert_eq!(back, data);
    }
}
