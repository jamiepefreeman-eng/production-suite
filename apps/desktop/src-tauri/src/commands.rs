//! General commands: show file, engine, patch, DMX hardware.

use crate::state::AppState;
use crate::usb_dmx::SerialPortInfo;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use suite_core::engine::{Command, Event};
use suite_core::lighting::Look;
use suite_core::presenter::Presentation;
use suite_core::show::Show;
use tauri::State;

type S<'a> = State<'a, Arc<AppState>>;

#[tauri::command]
pub fn get_show(state: S<'_>) -> Show {
    state.show()
}

/// Every module talks to the engine through this one command.
#[tauri::command]
pub fn engine_command(state: S<'_>, command: Command) -> Vec<Event> {
    state.dispatch(command)
}

#[derive(Serialize)]
pub struct EngineStatus {
    pub active_cue: Option<u32>,
    pub live_slide: Option<(u32, u32)>,
    pub programmer: Look,
    pub layers: suite_core::engine::Layers,
    pub show_path: Option<PathBuf>,
}

#[tauri::command]
pub fn engine_status(state: S<'_>) -> EngineStatus {
    let e = state.engine.lock().unwrap();
    EngineStatus {
        active_cue: e.active_cue(),
        live_slide: e.live_slide(),
        programmer: e.programmer.clone(),
        layers: e.layers().clone(),
        show_path: state.show_path.lock().unwrap().clone(),
    }
}

#[tauri::command]
pub fn open_show(state: S<'_>, path: PathBuf) -> Result<Show, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let show: Show = serde_json::from_str(&text).map_err(|e| format!("Not a valid show file: {e}"))?;
    state.dispatch(Command::LoadShow { show: show.clone() });
    *state.show_path.lock().unwrap() = Some(path);
    Ok(show)
}

#[tauri::command]
pub fn save_show(state: S<'_>, path: Option<PathBuf>) -> Result<PathBuf, String> {
    let path = path
        .or_else(|| state.show_path.lock().unwrap().clone())
        .ok_or("No file chosen")?;
    let json = serde_json::to_string_pretty(&state.show()).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    *state.show_path.lock().unwrap() = Some(path.clone());
    Ok(path)
}

#[tauri::command]
pub fn new_demo_show(state: S<'_>) -> Show {
    let show = suite_core::demo::demo_show();
    state.dispatch(Command::LoadShow { show: show.clone() });
    *state.show_path.lock().unwrap() = None;
    show
}

/// Pure helper: pasted lyrics -> presentation (the UI adds it to the show).
#[tauri::command]
pub fn parse_lyrics(state: S<'_>, title: String, text: String, max_lines: Option<usize>) -> Presentation {
    let id = state.engine.lock().unwrap().show.next_presentation_id();
    suite_core::presenter::parse_lyrics(id, &title, &text, max_lines.unwrap_or(4))
}

#[tauri::command]
pub fn patch_warnings(state: S<'_>) -> Vec<String> {
    state.engine.lock().unwrap().show.patch_warnings()
}

#[tauri::command]
pub fn list_serial_ports() -> Vec<SerialPortInfo> {
    crate::usb_dmx::list_ports()
}

#[derive(Serialize)]
pub struct OutputStatus {
    pub name: String,
    pub show_universe: u16,
    pub error: Option<String>,
}

#[tauri::command]
pub fn dmx_output_status(state: S<'_>) -> (Vec<OutputStatus>, Vec<String>) {
    let outs = state
        .outputs
        .lock()
        .unwrap()
        .iter()
        .map(|o| OutputStatus { name: o.sink.name(), show_universe: o.show_universe, error: o.last_error.clone() })
        .collect();
    (outs, state.output_errors.lock().unwrap().clone())
}
