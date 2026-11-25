//! MIDI controllers → engine. Each input port's raw bytes are parsed by
//! `suite_core::midi` and sent as `Command::MidiInput`; the engine maps them to
//! Lighting's show page (buttons / faders, "MIDI learn").
//!
//! The midir connections live on their own thread (some platforms' handles can't be
//! shared between threads), which reconnects when told which ports to use.

use crate::state::AppState;
use serde::Serialize;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use suite_core::engine::Command;
use suite_core::midi::MidiMessage;
use tauri::{AppHandle, State};

#[derive(Serialize, Clone, Debug, Default)]
pub struct MidiStatus {
    /// Every MIDI input the computer has right now.
    pub available: Vec<String>,
    /// The ones this app listens to.
    pub connected: Vec<String>,
    pub errors: Vec<String>,
}

/// `None` = listen to every input.
type Request = (Option<Vec<String>>, Sender<MidiStatus>);

static WORKER: Mutex<Option<Sender<Request>>> = Mutex::new(None);

fn port_names() -> Vec<String> {
    match midir::MidiInput::new("Production Suite") {
        Ok(m) => m.ports().iter().filter_map(|p| m.port_name(p).ok()).collect(),
        Err(_) => vec![],
    }
}

fn worker(state: Arc<AppState>) -> Sender<Request> {
    let (tx, rx) = channel::<Request>();
    let _ = std::thread::Builder::new().name("midi".into()).spawn(move || {
        let mut conns: Vec<midir::MidiInputConnection<()>> = Vec::new();
        for (wanted, reply) in rx {
            conns.clear(); // closes the old ports
            let mut st = MidiStatus { available: port_names(), ..Default::default() };
            let names: Vec<String> = match &wanted {
                Some(w) => w.iter().filter(|n| st.available.contains(n)).cloned().collect(),
                None => st.available.clone(),
            };
            if let Some(w) = &wanted {
                for n in w.iter().filter(|n| !st.available.contains(n)) {
                    st.errors.push(format!("“{n}” isn't plugged in"));
                }
            }
            for name in names {
                let input = match midir::MidiInput::new("Production Suite") {
                    Ok(i) => i,
                    Err(e) => {
                        st.errors.push(e.to_string());
                        continue;
                    }
                };
                let Some(port) = input.ports().into_iter().find(|p| input.port_name(p).ok().as_deref() == Some(name.as_str())) else {
                    continue;
                };
                let s = state.clone();
                match input.connect(
                    &port,
                    "production-suite-in",
                    move |_, bytes, _| {
                        if let Some(message) = MidiMessage::parse(bytes) {
                            s.dispatch(Command::MidiInput { message });
                        }
                    },
                    (),
                ) {
                    Ok(c) => {
                        conns.push(c);
                        st.connected.push(name);
                    }
                    Err(e) => st.errors.push(format!("{name}: {e}")),
                }
            }
            let _ = reply.send(st);
        }
    });
    tx
}

fn request(state: &Arc<AppState>, wanted: Option<Vec<String>>) -> MidiStatus {
    let tx = {
        let mut w = WORKER.lock().unwrap();
        w.get_or_insert_with(|| worker(state.clone())).clone()
    };
    let (rtx, rrx) = channel();
    if tx.send((wanted, rtx)).is_err() {
        return MidiStatus { errors: vec!["MIDI stopped working — restart the app".into()], ..Default::default() };
    }
    let st = rrx.recv_timeout(std::time::Duration::from_secs(10)).unwrap_or_default();
    *state.midi_connected.lock().unwrap() = st.connected.clone();
    st
}

/// At start-up: listen to the inputs chosen last time (all of them the first time).
pub fn start(state: Arc<AppState>) {
    let wanted = state.settings.lock().unwrap().midi_inputs.clone();
    let _ = std::thread::Builder::new().name("midi-start".into()).spawn(move || {
        request(&state, wanted);
    });
}

/// Inputs on this computer and which ones are in use. Async + blocking pool: port scans can be slow.
#[tauri::command]
pub async fn midi_status(state: State<'_, Arc<AppState>>) -> Result<MidiStatus, String> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connected = s.midi_connected.lock().unwrap().clone();
        MidiStatus { available: port_names(), connected, errors: vec![] }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Listen to these inputs (`null` = all) and remember the choice.
#[tauri::command]
pub async fn midi_connect(app: AppHandle, state: State<'_, Arc<AppState>>, inputs: Option<Vec<String>>) -> Result<MidiStatus, String> {
    let s = state.inner().clone();
    {
        let mut set = s.settings.lock().unwrap();
        set.midi_inputs = inputs.clone();
        set.save(&app)?;
    }
    tauri::async_runtime::spawn_blocking(move || request(&s, inputs)).await.map_err(|e| e.to_string())
}
