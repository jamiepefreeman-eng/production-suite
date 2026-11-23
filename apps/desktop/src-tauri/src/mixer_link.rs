//! Connection to the mixing desk. Engine `MixerOut` events land here.

use crate::state::AppState;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use suite_core::engine::Command;
use suite_core::mixer::connection::MixerConnection;
use suite_core::mixer::{MixerCommand, MixerConfig, MixerKind};
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Clone)]
pub struct MixerStatus {
    pub connected: bool,
    pub config: Option<MixerConfig>,
    pub input_channels: u8,
    pub kinds: Vec<(MixerKind, String)>,
}

pub fn send(state: &AppState, app: &AppHandle, cmd: &MixerCommand) {
    let mut guard = state.mixer.lock().unwrap();
    let Some(conn) = guard.as_mut() else {
        let _ = app.emit("mixer-error", "No mixer connected — command not sent");
        return;
    };
    if let Err(e) = conn.send(cmd) {
        let _ = app.emit("mixer-error", e.to_string());
    }
}

pub fn spawn_tick(state: Arc<AppState>, app: AppHandle) {
    std::thread::Builder::new()
        .name("mixer".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(50));
            let mut guard = state.mixer.lock().unwrap();
            if let Some(conn) = guard.as_mut() {
                match conn.tick() {
                    Ok(fb) if !fb.is_empty() => {
                        let _ = app.emit("mixer-feedback", fb);
                    }
                    Ok(_) => {}
                    Err(e) => {
                        let _ = app.emit("mixer-error", format!("Mixer disconnected: {e}"));
                        *guard = None;
                    }
                }
            }
        })
        .expect("spawn mixer thread");
}

fn status_of(state: &AppState) -> MixerStatus {
    let guard = state.mixer.lock().unwrap();
    MixerStatus {
        connected: guard.is_some(),
        config: guard.as_ref().map(|c| c.config.clone()),
        input_channels: guard.as_ref().map(|c| c.input_channels()).unwrap_or(0),
        kinds: MixerKind::ALL.iter().map(|k| (*k, k.label().to_string())).collect(),
    }
}

#[tauri::command]
pub fn mixer_connect(state: State<'_, Arc<AppState>>, config: MixerConfig) -> Result<MixerStatus, String> {
    let conn = MixerConnection::connect(&config).map_err(|e| format!("Couldn't reach {}: {e}", config.ip))?;
    *state.mixer.lock().unwrap() = Some(conn);
    // Remember it in the show so it reconnects next time.
    let mut show = state.show();
    show.mixer = Some(config);
    state.dispatch(Command::ReplaceShow { show });
    Ok(status_of(&state))
}

#[tauri::command]
pub fn mixer_disconnect(state: State<'_, Arc<AppState>>) -> MixerStatus {
    *state.mixer.lock().unwrap() = None;
    status_of(&state)
}

#[tauri::command]
pub fn mixer_status(state: State<'_, Arc<AppState>>) -> MixerStatus {
    status_of(&state)
}
