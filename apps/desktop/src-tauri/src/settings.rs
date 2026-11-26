//! Per-install settings in the app config folder.
//! TODO: move the API key into the OS keychain (keyring crate).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub anthropic_api_key: Option<String>,
    pub ai_model: Option<String>,
    pub last_show: Option<PathBuf>,
    /// MIDI inputs to listen to; `None` = all of them.
    pub midi_inputs: Option<Vec<String>>,
    /// Lyric Follow input on this computer.
    pub follow_input: Option<crate::lyric_follow::FollowInput>,
    /// Shows opened or saved on this computer, newest first (Presenter › Services).
    pub recent_shows: Vec<RecentShow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecentShow {
    pub path: PathBuf,
    pub name: String,
    /// Unix ms of the last open / save.
    pub used_at: u64,
}

const MAX_RECENT: usize = 30;

impl Settings {
    /// Put this show at the top of the recent list.
    pub fn remember_show(&mut self, path: &std::path::Path, name: &str) {
        self.recent_shows.retain(|r| r.path != path);
        let used_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        self.recent_shows.insert(0, RecentShow { path: path.to_path_buf(), name: name.to_string(), used_at });
        self.recent_shows.truncate(MAX_RECENT);
    }
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

impl Settings {
    pub fn load(app: &AppHandle) -> Self {
        path(app)
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let p = path(app).ok_or("no config dir")?;
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(p, serde_json::to_string_pretty(self).unwrap()).map_err(|e| e.to_string())
    }

    pub fn api_key(&self) -> Option<String> {
        self.anthropic_api_key
            .clone()
            .filter(|k| !k.trim().is_empty())
            .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok())
    }
}
