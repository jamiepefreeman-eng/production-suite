//! ANSI E1.31 (sACN) data packets on UDP port 5568.
//! Multicast group for universe U is 239.255.(U >> 8).(U & 0xFF).

use super::{DmxSink, UNIVERSE_SIZE};
use std::io;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, ToSocketAddrs, UdpSocket};

pub const PORT: u16 = 5568;
const ACN_ID: [u8; 12] = *b"ASC-E1.17\0\0\0";
const VECTOR_ROOT_E131_DATA: u32 = 0x0000_0004;
const VECTOR_E131_DATA_PACKET: u32 = 0x0000_0002;
const VECTOR_DMP_SET_PROPERTY: u8 = 0x02;
pub const PACKET_LEN: usize = 638;

pub fn multicast_addr(universe: u16) -> Ipv4Addr {
    Ipv4Addr::new(239, 255, (universe >> 8) as u8, (universe & 0xFF) as u8)
}

fn flags_len(len: usize) -> [u8; 2] {
    (0x7000u16 | (len as u16 & 0x0FFF)).to_be_bytes()
}

pub fn build_packet(
    cid: &[u8; 16],
    source_name: &str,
    priority: u8,
    sequence: u8,
    universe: u16,
    data: &[u8],
) -> Vec<u8> {
    let mut p = Vec::with_capacity(PACKET_LEN);
    // Root layer
    p.extend_from_slice(&0x0010u16.to_be_bytes()); // preamble size
    p.extend_from_slice(&0x0000u16.to_be_bytes()); // postamble size
    p.extend_from_slice(&ACN_ID);
    p.extend_from_slice(&flags_len(PACKET_LEN - 16));
    p.extend_from_slice(&VECTOR_ROOT_E131_DATA.to_be_bytes());
    p.extend_from_slice(cid);
    // Framing layer (offset 38)
    p.extend_from_slice(&flags_len(PACKET_LEN - 38));
    p.extend_from_slice(&VECTOR_E131_DATA_PACKET.to_be_bytes());
    let mut name = [0u8; 64];
    for (i, b) in source_name.as_bytes().iter().take(63).enumerate() {
        name[i] = *b;
    }
    p.extend_from_slice(&name);
    p.push(priority.min(200));
    p.extend_from_slice(&0u16.to_be_bytes()); // sync address
    p.push(sequence);
    p.push(0); // options
    p.extend_from_slice(&universe.to_be_bytes());
    // DMP layer (offset 115)
    p.extend_from_slice(&flags_len(PACKET_LEN - 115));
    p.push(VECTOR_DMP_SET_PROPERTY);
    p.push(0xA1); // address & data type
    p.extend_from_slice(&0u16.to_be_bytes()); // first property address
    p.extend_from_slice(&1u16.to_be_bytes()); // address increment
    p.extend_from_slice(&513u16.to_be_bytes()); // property value count
    p.push(0); // DMX start code
    for i in 0..UNIVERSE_SIZE {
        p.push(*data.get(i).unwrap_or(&0));
    }
    debug_assert_eq!(p.len(), PACKET_LEN);
    p
}

/// Parse an E1.31 data packet into (universe, priority, data).
pub fn parse_packet(pkt: &[u8]) -> Option<(u16, u8, Vec<u8>)> {
    if pkt.len() < 126 || pkt[4..16] != ACN_ID {
        return None;
    }
    if u32::from_be_bytes([pkt[18], pkt[19], pkt[20], pkt[21]]) != VECTOR_ROOT_E131_DATA {
        return None;
    }
    if u32::from_be_bytes([pkt[40], pkt[41], pkt[42], pkt[43]]) != VECTOR_E131_DATA_PACKET {
        return None;
    }
    let priority = pkt[108];
    let universe = u16::from_be_bytes([pkt[113], pkt[114]]);
    let count = u16::from_be_bytes([pkt[123], pkt[124]]) as usize;
    if pkt[125] != 0 {
        return None; // not a DMX null start code
    }
    let end = (125 + count).min(pkt.len());
    let mut data = pkt[126..end].to_vec();
    data.resize(UNIVERSE_SIZE, 0);
    Some((universe, priority, data))
}

pub struct SacnSender {
    socket: UdpSocket,
    target: SocketAddr,
    cid: [u8; 16],
    universe: u16,
    priority: u8,
    sequence: u8,
    source_name: String,
}

impl SacnSender {
    pub fn new(sacn_universe: u16, priority: u8, unicast_ip: Option<&str>) -> io::Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0")?;
        socket.set_multicast_ttl_v4(8)?;
        let target = match unicast_ip {
            Some(ip) => (ip, PORT)
                .to_socket_addrs()?
                .next()
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "bad sACN address"))?,
            None => SocketAddr::V4(SocketAddrV4::new(multicast_addr(sacn_universe), PORT)),
        };
        // Stable-ish CID derived from the process; replace with a stored UUID per install.
        let mut cid = [0u8; 16];
        let seed = std::process::id().to_be_bytes();
        cid[..4].copy_from_slice(&seed);
        cid[4..15].copy_from_slice(b"ProdSuite01");
        Ok(Self {
            socket,
            target,
            cid,
            universe: sacn_universe,
            priority,
            sequence: 0,
            source_name: "Production Suite".into(),
        })
    }
}

impl DmxSink for SacnSender {
    fn name(&self) -> String {
        format!("sACN univ {} -> {}", self.universe, self.target)
    }

    fn send(&mut self, _universe: u16, data: &[u8]) -> io::Result<()> {
        let pkt = build_packet(&self.cid, &self.source_name, self.priority, self.sequence, self.universe, data);
        self.sequence = self.sequence.wrapping_add(1);
        self.socket.send_to(&pkt, self.target).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_and_roundtrip() {
        let mut data = vec![0u8; 512];
        data[0] = 10;
        data[100] = 99;
        let pkt = build_packet(&[1; 16], "test", 100, 3, 0x0102, &data);
        assert_eq!(pkt.len(), 638);
        assert_eq!(pkt[16..18], [0x72, 0x6e]); // 0x7000 | 622
        assert_eq!(pkt[38..40], [0x72, 0x58]); // 0x7000 | 600
        assert_eq!(pkt[115..117], [0x72, 0x0b]); // 0x7000 | 523
        let (u, prio, back) = parse_packet(&pkt).unwrap();
        assert_eq!((u, prio), (0x0102, 100));
        assert_eq!(back, data);
        assert_eq!(multicast_addr(1), Ipv4Addr::new(239, 255, 0, 1));
    }
}
