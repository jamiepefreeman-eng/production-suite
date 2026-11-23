//! Network transport shared by every mixer profile.

use super::osc;
use super::{profile_for, MixerCommand, MixerConfig, MixerProfile, Transport};
use std::io::{self, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket};
use std::time::{Duration, Instant};

enum Link {
    Udp(UdpSocket, SocketAddr),
    Tcp(TcpStream),
}

pub struct MixerConnection {
    profile: Box<dyn MixerProfile>,
    link: Link,
    last_keepalive: Option<Instant>,
    pub config: MixerConfig,
}

/// Something the desk told us (X32/X Air OSC feedback for now).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MixerFeedback {
    pub address: String,
    pub value: Option<f32>,
}

impl MixerConnection {
    pub fn connect(config: &MixerConfig) -> io::Result<Self> {
        let profile = profile_for(config);
        let link = match profile.transport() {
            Transport::Udp(port) => {
                let addr = (config.ip.as_str(), port)
                    .to_socket_addrs()?
                    .next()
                    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "bad mixer IP"))?;
                let sock = UdpSocket::bind("0.0.0.0:0")?;
                sock.set_read_timeout(Some(Duration::from_millis(20)))?;
                Link::Udp(sock, addr)
            }
            Transport::Tcp(port) => {
                let addr = (config.ip.as_str(), port)
                    .to_socket_addrs()?
                    .next()
                    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "bad mixer IP"))?;
                let s = TcpStream::connect_timeout(&addr, Duration::from_secs(3))?;
                s.set_nodelay(true)?;
                s.set_read_timeout(Some(Duration::from_millis(20)))?;
                Link::Tcp(s)
            }
        };
        let mut c = Self {
            profile,
            link,
            last_keepalive: None,
            config: config.clone(),
        };
        c.tick()?;
        Ok(c)
    }

    fn raw(&mut self, bytes: &[u8]) -> io::Result<()> {
        match &mut self.link {
            Link::Udp(s, addr) => s.send_to(bytes, *addr).map(|_| ()),
            Link::Tcp(s) => s.write_all(bytes),
        }
    }

    pub fn send(&mut self, cmd: &MixerCommand) -> io::Result<usize> {
        let packets = self.profile.encode(cmd);
        for p in &packets {
            self.raw(p)?;
        }
        Ok(packets.len())
    }

    /// Call often (e.g. every 50 ms): renews keep-alives and drains feedback.
    pub fn tick(&mut self) -> io::Result<Vec<MixerFeedback>> {
        if let Some((pkt, every)) = self.profile.keepalive() {
            if self.last_keepalive.map_or(true, |t| t.elapsed() >= every) {
                self.raw(&pkt)?;
                self.last_keepalive = Some(Instant::now());
            }
        }
        let mut out = Vec::new();
        let mut buf = [0u8; 2048];
        loop {
            let n = match &mut self.link {
                Link::Udp(s, _) => match s.recv_from(&mut buf) {
                    Ok((n, _)) => n,
                    Err(e) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => break,
                    Err(e) => return Err(e),
                },
                Link::Tcp(s) => match s.read(&mut buf) {
                    Ok(0) => return Err(io::Error::new(io::ErrorKind::ConnectionAborted, "mixer closed connection")),
                    Ok(n) => n,
                    Err(e) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => break,
                    Err(e) => return Err(e),
                },
            };
            if let Some((address, args)) = osc::decode(&buf[..n]) {
                let value = args.first().and_then(|a| match a {
                    osc::OscArg::Float(f) => Some(*f),
                    osc::OscArg::Int(i) => Some(*i as f32),
                    _ => None,
                });
                out.push(MixerFeedback { address, value });
            }
            // TODO: parse A&H MIDI feedback (NRPN echoes) for SQ/Avantis.
            if out.len() > 256 {
                break;
            }
        }
        Ok(out)
    }

    pub fn input_channels(&self) -> u8 {
        self.profile.input_channels()
    }
}
