//! Desktop shell. Owns the engine, runs the real-time threads and bridges
//! everything to the React front end.
//!
//! Threads:
//! * **dmx**      — 40 Hz: engine.frame() -> DMX outputs; 20 Hz visualizer frames to the UI
//! * **events**   — engine events -> UI (`engine-event`) and MixerOut -> desk
//! * **mixer**    — 20 Hz keep-alive + desk feedback (`mixer-feedback`)
//! * **viz-in**   — optional Art-Net/sACN listener so the Visualizer can show an external console

mod ai_client;
mod audio;
mod commands;
mod dmx_out;
mod mixer_link;
mod settings;
mod state;
mod usb_dmx;
mod viz_input;
mod windows;

use state::AppState;
use std::sync::Arc;
use suite_core::engine::Event;
use tauri::{Emitter, Manager};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let settings = settings::Settings::load(app.handle());
            let state = Arc::new(AppState::new(suite_core::demo::demo_show(), settings));
            app.manage(state.clone());

            // Engine events -> UI + mixer.
            let rx = state.bus.subscribe();
            let handle = app.handle().clone();
            let st = state.clone();
            std::thread::Builder::new().name("events".into()).spawn(move || {
                for ev in rx {
                    if let Event::MixerOut { command } = &ev {
                        mixer_link::send(&st, &handle, command);
                    }
                    if matches!(ev, Event::ShowChanged) {
                        dmx_out::rebuild_if_needed(&st);
                    }
                    let _ = handle.emit("engine-event", &ev);
                }
            })?;

            dmx_out::rebuild(&state);
            dmx_out::spawn_loop(state.clone(), app.handle().clone());
            mixer_link::spawn_tick(state.clone(), app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_show,
            commands::engine_command,
            commands::engine_status,
            commands::open_show,
            commands::save_show,
            commands::new_demo_show,
            commands::parse_lyrics,
            commands::patch_warnings,
            commands::list_serial_ports,
            commands::dmx_output_status,
            audio::list_audio_devices,
            mixer_link::mixer_connect,
            mixer_link::mixer_disconnect,
            mixer_link::mixer_status,
            ai_client::ai_build_scene,
            ai_client::ai_status,
            ai_client::set_api_key,
            viz_input::set_visualizer_source,
            windows::list_monitors,
            windows::open_output_window,
            windows::open_module_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Production Suite");
}
