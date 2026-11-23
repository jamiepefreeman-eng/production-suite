//! Extra windows: presentation outputs on other displays, and pop-out
//! modules so Presenter / Lighting / Audio / Visualizer can each run as
//! their own window (or on their own screen) while sharing one engine.

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize)]
pub struct MonitorInfo {
    pub index: usize,
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale: f64,
}

fn monitors(app: &AppHandle) -> Result<Vec<tauri::Monitor>, String> {
    let main = app.get_webview_window("main").ok_or("main window missing")?;
    main.available_monitors().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    Ok(monitors(&app)?
        .into_iter()
        .enumerate()
        .map(|(index, m)| MonitorInfo {
            index,
            name: m.name().cloned(),
            width: m.size().width,
            height: m.size().height,
            x: m.position().x,
            y: m.position().y,
            scale: m.scale_factor(),
        })
        .collect())
}

/// `kind`: "audience" | "stage" | "stream". Async: creating windows from a sync
/// command can deadlock on Windows.
#[tauri::command]
pub async fn open_output_window(app: AppHandle, kind: String, monitor: Option<usize>) -> Result<(), String> {
    let label = format!("output-{kind}");
    if let Some(w) = app.get_webview_window(&label) {
        return w.close().map_err(|e| e.to_string());
    }
    let mut b = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("index.html#output={kind}").into()))
        .title(format!("Output — {kind}"))
        .decorations(monitor.is_none())
        .inner_size(1280.0, 720.0);
    if let Some(i) = monitor {
        let mons = monitors(&app)?;
        let m = mons.get(i).ok_or("no such monitor")?;
        let s = m.scale_factor();
        b = b
            .position(m.position().x as f64 / s, m.position().y as f64 / s)
            .inner_size(m.size().width as f64 / s, m.size().height as f64 / s)
            .always_on_top(true);
    }
    let w = b.build().map_err(|e| e.to_string())?;
    if monitor.is_some() {
        let _ = w.set_fullscreen(true);
    }
    Ok(())
}

/// `module`: "presenter" | "lighting" | "audio" | "visualizer"
#[tauri::command]
pub async fn open_module_window(app: AppHandle, module: String) -> Result<(), String> {
    let label = format!("module-{module}");
    if let Some(w) = app.get_webview_window(&label) {
        return w.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("index.html#module={module}").into()))
        .title(format!("Production Suite — {module}"))
        .inner_size(1280.0, 800.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
