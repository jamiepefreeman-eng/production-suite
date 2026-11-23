//! Builds DMX sinks from the show's output config and runs the 40 Hz loop.

use crate::state::{AppState, OutputSlot};
use crate::viz_input::VizSource;
use serde::Serialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use suite_core::dmx::artnet::ArtNetSender;
use suite_core::dmx::sacn::SacnSender;
use suite_core::dmx::{DmxOutputConfig, DmxSink};
use suite_core::lighting::{decode_visuals, FixtureVisual};
use tauri::{AppHandle, Emitter};

const DMX_HZ: u64 = 40;
const VIZ_EVERY_N_FRAMES: u64 = 2; // 20 Hz to the UI

fn build_sink(cfg: &DmxOutputConfig) -> Result<Box<dyn DmxSink>, String> {
    match cfg {
        DmxOutputConfig::ArtNet { ip, artnet_universe, .. } => {
            ArtNetSender::new(ip, *artnet_universe).map(|s| Box::new(s) as Box<dyn DmxSink>).map_err(|e| e.to_string())
        }
        DmxOutputConfig::Sacn { sacn_universe, priority, unicast_ip, .. } => {
            SacnSender::new(*sacn_universe, *priority, unicast_ip.as_deref())
                .map(|s| Box::new(s) as Box<dyn DmxSink>)
                .map_err(|e| e.to_string())
        }
        DmxOutputConfig::EnttecPro { port, .. } => crate::usb_dmx::open_pro(port),
        DmxOutputConfig::OpenDmx { port, .. } => crate::usb_dmx::open_open_dmx(port),
    }
}

pub fn rebuild(state: &AppState) {
    let configs = state.engine.lock().unwrap().show.dmx_outputs.clone();
    let mut slots = Vec::new();
    let mut errors = Vec::new();
    for cfg in &configs {
        match build_sink(cfg) {
            Ok(sink) => slots.push(OutputSlot { show_universe: cfg.show_universe(), sink, last_error: None }),
            Err(e) => errors.push(format!("{cfg:?}: {e}")),
        }
    }
    *state.outputs.lock().unwrap() = slots;
    *state.output_errors.lock().unwrap() = errors;
    *state.outputs_built_from.lock().unwrap() = configs;
}

pub fn rebuild_if_needed(state: &AppState) {
    let current = state.engine.lock().unwrap().show.dmx_outputs.clone();
    if *state.outputs_built_from.lock().unwrap() != current {
        rebuild(state);
    }
}

#[derive(Serialize, Clone)]
pub(crate) struct VizFrame<'a> {
    pub source: &'a str,
    pub fixtures: Vec<FixtureVisual>,
}

pub fn spawn_loop(state: Arc<AppState>, app: AppHandle) {
    std::thread::Builder::new()
        .name("dmx".into())
        .spawn(move || {
            let period = Duration::from_millis(1000 / DMX_HZ);
            let mut next = Instant::now();
            let mut n: u64 = 0;
            loop {
                let now = Instant::now();
                let frame = state.engine.lock().unwrap().frame(now);

                {
                    let mut outs = state.outputs.lock().unwrap();
                    for slot in outs.iter_mut() {
                        let zero = vec![0u8; 512];
                        let data = frame.universes.get(&slot.show_universe).unwrap_or(&zero);
                        slot.last_error = slot.sink.send(slot.show_universe, data).err().map(|e| e.to_string());
                    }
                }

                if n.is_multiple_of(VIZ_EVERY_N_FRAMES) {
                    let source = state.viz_source.lock().unwrap().clone();
                    let engine = state.engine.lock().unwrap();
                    let (label, visuals) = match source {
                        VizSource::Internal => ("internal", decode_visuals(&engine.show, &frame)),
                        _ => {
                            let ext = state.external_frame.lock().unwrap().clone();
                            ("external", decode_visuals(&engine.show, &ext))
                        }
                    };
                    drop(engine);
                    let _ = app.emit("visualizer-frame", VizFrame { source: label, fixtures: visuals });
                }

                n += 1;
                next += period;
                let now = Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                } else {
                    next = now; // fell behind; don't spiral
                }
            }
        })
        .expect("spawn dmx thread");
}
