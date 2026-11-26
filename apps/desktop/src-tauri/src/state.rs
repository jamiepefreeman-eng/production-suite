use crate::settings::Settings;
use crate::viz_input::VizSource;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use suite_core::bus::Bus;
use suite_core::dmx::{DmxFrame, DmxOutputConfig, DmxSink};
use suite_core::engine::{Command, Engine, Event};
use suite_core::mixer::connection::MixerConnection;
use suite_core::show::Show;

pub struct OutputSlot {
    pub show_universe: u16,
    pub sink: Box<dyn DmxSink>,
    pub last_error: Option<String>,
}

pub struct AppState {
    pub engine: Mutex<Engine>,
    pub bus: Bus<Event>,
    pub outputs: Mutex<Vec<OutputSlot>>,
    /// The output config the sinks were built from, to detect changes.
    pub outputs_built_from: Mutex<Vec<DmxOutputConfig>>,
    pub output_errors: Mutex<Vec<String>>,
    pub mixer: Mutex<Option<MixerConnection>>,
    pub viz_source: Mutex<VizSource>,
    /// Latest DMX heard from an external console (Visualizer input mode).
    pub external_frame: Arc<Mutex<DmxFrame>>,
    pub show_path: Mutex<Option<PathBuf>>,
    pub settings: Mutex<Settings>,
    /// MIDI inputs currently open (see midi_link).
    pub midi_connected: Mutex<Vec<String>>,
    pub follow: Mutex<crate::lyric_follow::FollowRuntime>,
}

impl AppState {
    pub fn new(show: Show, settings: Settings) -> Self {
        Self {
            engine: Mutex::new(Engine::new(show)),
            bus: Bus::new(),
            outputs: Mutex::new(Vec::new()),
            outputs_built_from: Mutex::new(Vec::new()),
            output_errors: Mutex::new(Vec::new()),
            mixer: Mutex::new(None),
            viz_source: Mutex::new(VizSource::Internal),
            external_frame: Arc::new(Mutex::new(DmxFrame::default())),
            show_path: Mutex::new(None),
            settings: Mutex::new(settings),
            midi_connected: Mutex::new(Vec::new()),
            follow: Mutex::new(Default::default()),
        }
    }

    /// The single entry point every module uses to change the show.
    pub fn dispatch(&self, cmd: Command) -> Vec<Event> {
        let events = self.engine.lock().unwrap().handle(cmd, Instant::now());
        self.bus.publish_all(events.clone());
        events
    }

    pub fn show(&self) -> Show {
        self.engine.lock().unwrap().show.clone()
    }
}
