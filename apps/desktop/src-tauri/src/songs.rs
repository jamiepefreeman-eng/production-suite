//! Song import (SongSelect / ChordPro files) and the CCLI usage log.
//!
//! Usage log: every time a song's slide goes live the song is noted once per service (a new entry
//! only if the same song wasn't logged in the last 6 hours). Kept per computer in the app data folder
//! (`ccli-usage.json`), so it covers every show file. The Presenter's CCLI report reads it.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use suite_core::presenter::{songselect, Presentation, PresentationKind};
use tauri::{AppHandle, Manager, State};

type S<'a> = State<'a, Arc<AppState>>;

#[derive(Serialize)]
pub struct ImportedSong {
    pub path: String,
    pub presentation: Option<Presentation>,
    pub error: Option<String>,
}

fn file_title(path: &Path) -> String {
    path.file_stem().and_then(|s| s.to_str()).unwrap_or("Song").replace('_', " ")
}

/// Read song files (SongSelect .txt, ChordPro .cho/.chordpro/.chopro/.crd/.pro, plain lyrics). The UI files
/// them into the Library. Ids are placeholders; the UI gives each a real one.
#[tauri::command]
pub fn import_song_files(paths: Vec<PathBuf>, max_lines: Option<usize>) -> Vec<ImportedSong> {
    paths
        .into_iter()
        .map(|p| {
            let path = p.display().to_string();
            match std::fs::read(&p) {
                Ok(bytes) => {
                    // SongSelect files are UTF-8; older ones can be Windows-1252: fall back lossily.
                    let text = String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());
                    let pres = songselect::import_song(0, &text, &file_title(&p), max_lines.unwrap_or(4));
                    if pres.slides.is_empty() {
                        ImportedSong { path, presentation: None, error: Some("no lyrics found in this file".into()) }
                    } else {
                        ImportedSong { path, presentation: Some(pres), error: None }
                    }
                }
                Err(e) => ImportedSong { path, presentation: None, error: Some(e.to_string()) },
            }
        })
        .collect()
}

/// Pasted text from SongSelect ("Copy lyrics"), a ChordPro chart or plain lyrics.
#[tauri::command]
pub fn import_song_text(state: S<'_>, text: String, title: String, max_lines: Option<usize>) -> Presentation {
    let id = state.engine.lock().unwrap().show.next_presentation_id();
    songselect::import_song(id, &text, if title.trim().is_empty() { "Untitled" } else { &title }, max_lines.unwrap_or(4))
}

/// Write a text file the user picked in a Save dialog (CCLI report CSV).
#[tauri::command]
pub fn write_text_file(path: PathBuf, text: String) -> Result<(), String> {
    std::fs::write(path, text).map_err(|e| e.to_string())
}

// ───────────────────────────────────────────── CCLI usage log

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UsageEntry {
    /// Unix ms when it was first shown.
    pub at: u64,
    pub title: String,
    pub ccli: Option<String>,
    pub authors: String,
    pub copyright: String,
    /// The show (service) it was in.
    pub show: String,
}

static LOCK: Mutex<()> = Mutex::new(());
const SAME_SERVICE_MS: u64 = 6 * 3600 * 1000;
const MAX_ENTRIES: usize = 20_000;

fn usage_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("ccli-usage.json"))
}

fn read(path: &Path) -> Vec<UsageEntry> {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Add `song` to `log` unless it was already logged for this service. Returns true if added.
pub fn log_use(log: &mut Vec<UsageEntry>, song: &Presentation, show: &str, at: u64) -> bool {
    let key = |e: &UsageEntry| e.ccli.clone().filter(|c| !c.is_empty()).unwrap_or_else(|| e.title.to_lowercase());
    let entry = UsageEntry { at, title: song.title.clone(), ccli: song.ccli.clone(), authors: song.authors.clone(), copyright: song.copyright.clone(), show: show.to_string() };
    let k = key(&entry);
    if log.iter().rev().take_while(|e| at.saturating_sub(e.at) < SAME_SERVICE_MS).any(|e| key(e) == k) {
        return false;
    }
    log.push(entry);
    if log.len() > MAX_ENTRIES {
        let extra = log.len() - MAX_ENTRIES;
        log.drain(..extra);
    }
    true
}

/// Events thread: a slide went live.
pub fn on_slide_live(state: &AppState, app: &AppHandle, presentation: u32) {
    let (song, show_name) = {
        let e = state.engine.lock().unwrap();
        (e.show.presentation(presentation).cloned(), e.show.name.clone())
    };
    let Some(song) = song.filter(|p| p.kind == PresentationKind::Song) else { return };
    let Some(path) = usage_path(app) else { return };
    let _g = LOCK.lock().unwrap();
    let mut log = read(&path);
    if log_use(&mut log, &song, &show_name, now_ms()) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&path, serde_json::to_string(&log).unwrap_or_default());
    }
}

/// Every logged song use (oldest first). The UI filters by date and groups for the report.
#[tauri::command]
pub fn ccli_usage(app: AppHandle) -> Vec<UsageEntry> {
    let _g = LOCK.lock().unwrap();
    usage_path(&app).map(|p| read(&p)).unwrap_or_default()
}

/// Forget uses before `before_ms` (after they've been reported).
#[tauri::command]
pub fn ccli_usage_clear(app: AppHandle, before_ms: u64) -> Result<usize, String> {
    let _g = LOCK.lock().unwrap();
    let path = usage_path(&app).ok_or("no data folder")?;
    let mut log = read(&path);
    let n = log.len();
    log.retain(|e| e.at >= before_ms);
    std::fs::write(&path, serde_json::to_string(&log).unwrap_or_default()).map_err(|e| e.to_string())?;
    Ok(n - log.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_entry_per_song_per_service() {
        let mut song = suite_core::presenter::parse_lyrics(1, "Way Maker", "a", 2);
        song.ccli = Some("7115744".into());
        let mut log = vec![];
        let t = 1_800_000_000_000;
        assert!(log_use(&mut log, &song, "Sunday", t));
        assert!(!log_use(&mut log, &song, "Sunday", t + 60_000), "same service");
        let other = suite_core::presenter::parse_lyrics(2, "Goodness of God", "a", 2);
        assert!(log_use(&mut log, &other, "Sunday", t + 120_000));
        assert!(!log_use(&mut log, &song, "Sunday", t + 3_600_000), "song still in this service");
        assert!(log_use(&mut log, &song, "Next Sunday", t + 7 * 86_400_000));
        assert_eq!(log.len(), 3);
    }
}
