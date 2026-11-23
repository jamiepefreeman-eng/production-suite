//! Visualizer input: draw this app's own output (default), or listen to an
//! external console (Lightkey etc.) over Art-Net or sACN — the offline
//! programming visualizer, using the same patch.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use suite_core::dmx::{artnet, sacn};
use tauri::State;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum VizSource {
    Internal,
    /// Art-Net port-address N -> show universe N+1
    ArtNet,
    /// sACN universe N -> show universe N (multicast join for 1..=universes)
    Sacn { universes: u16 },
}

/// Bumped every time the source changes so old listener threads exit.
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn reusable_udp(port: u16) -> std::io::Result<UdpSocket> {
    let s = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    s.set_reuse_address(true)?;
    #[cfg(unix)]
    s.set_reuse_port(true)?;
    s.bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port).into())?;
    let u: UdpSocket = s.into();
    u.set_read_timeout(Some(Duration::from_millis(250)))?;
    Ok(u)
}

fn spawn_listener(state: Arc<AppState>, source: VizSource) -> Result<(), String> {
    let gen = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let sock = match &source {
        VizSource::Internal => return Ok(()),
        VizSource::ArtNet => reusable_udp(artnet::PORT).map_err(|e| e.to_string())?,
        VizSource::Sacn { universes } => {
            let s = reusable_udp(sacn::PORT).map_err(|e| e.to_string())?;
            for u in 1..=(*universes).max(1) {
                s.join_multicast_v4(&sacn::multicast_addr(u), &Ipv4Addr::UNSPECIFIED).map_err(|e| e.to_string())?;
            }
            s
        }
    };
    let frame = state.external_frame.clone();
    std::thread::Builder::new()
        .name("viz-in".into())
        .spawn(move || {
            let mut buf = [0u8; 1024];
            while GENERATION.load(Ordering::SeqCst) == gen {
                let Ok((n, _)) = sock.recv_from(&mut buf) else { continue };
                let parsed = match source {
                    VizSource::ArtNet => artnet::parse_artdmx(&buf[..n]).map(|(p, d)| (p + 1, d)),
                    VizSource::Sacn { .. } => sacn::parse_packet(&buf[..n]).map(|(u, _, d)| (u, d)),
                    VizSource::Internal => None,
                };
                if let Some((u, data)) = parsed {
                    frame.lock().unwrap().universes.insert(u, data);
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_visualizer_source(state: State<'_, Arc<AppState>>, source: VizSource) -> Result<(), String> {
    let st: Arc<AppState> = state.inner().clone();
    if source == VizSource::Internal {
        GENERATION.fetch_add(1, Ordering::SeqCst);
    } else {
        spawn_listener(st.clone(), source.clone())?;
    }
    *st.viz_source.lock().unwrap() = source;
    Ok(())
}
