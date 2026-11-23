//! AI scene builder bridge.
//!
//! 1. Try the offline parser. If it understood everything, done — no network.
//! 2. Otherwise (or when `force_llm`), ask Claude with the show's vocabulary
//!    and deserialize the JSON reply into the same intents.
//!
//! Either way the engine validates against the patch before anything moves.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use suite_core::ai::intent::ParseOutput;
use suite_core::ai::{self, prompt};
use suite_core::engine::Command;
use tauri::{AppHandle, State};

pub(crate) const DEFAULT_MODEL: &str = "claude-sonnet-5-5";
const API_URL: &str = "https://api.anthropic.com/v1/messages";

#[derive(Serialize, Clone)]
pub struct SceneResult {
    /// "offline" or "llm"
    pub engine: String,
    pub parsed: ParseOutput,
}

#[derive(Serialize)]
pub struct AiStatus {
    pub has_api_key: bool,
    pub model: String,
}

#[derive(Deserialize)]
struct ApiResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(default)]
    text: String,
}

fn extract_json(s: &str) -> Option<&str> {
    let start = s.find('{')?;
    let end = s.rfind('}')?;
    (end > start).then(|| &s[start..=end])
}

async fn ask_llm(key: &str, model: &str, system: String, text: &str) -> Result<ParseOutput, String> {
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "system": system,
        "messages": [{ "role": "user", "content": text }],
    });
    let resp = reqwest::Client::new()
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status();
        let msg = resp.text().await.unwrap_or_default();
        return Err(format!("AI error {code}: {msg}"));
    }
    let api: ApiResponse = resp.json().await.map_err(|e| e.to_string())?;
    let text = api.content.into_iter().map(|c| c.text).collect::<Vec<_>>().join("");
    let json = extract_json(&text).ok_or("AI reply had no JSON")?;
    serde_json::from_str::<ParseOutput>(json).map_err(|e| format!("AI reply didn't match the schema: {e}"))
}

#[tauri::command]
pub async fn ai_build_scene(
    state: State<'_, Arc<AppState>>,
    text: String,
    force_llm: bool,
) -> Result<SceneResult, String> {
    let show = state.show();
    let offline = ai::parse(&show, &text);
    let (key, model) = {
        let s = state.settings.lock().unwrap();
        (s.api_key(), s.ai_model.clone().unwrap_or_else(|| DEFAULT_MODEL.into()))
    };

    let use_llm = (force_llm || !offline.unknown.is_empty() || offline.intents.is_empty()) && key.is_some();
    let (engine, parsed) = if use_llm {
        match ask_llm(key.as_deref().unwrap(), &model, prompt::system_prompt(&show), &text).await {
            Ok(p) => ("llm", p),
            Err(e) => {
                // Fall back to whatever the offline parser understood.
                let mut p = offline.clone();
                p.unknown.push(e);
                ("offline", p)
            }
        }
    } else {
        ("offline", offline)
    };

    state.dispatch(Command::ApplyIntents {
        intents: parsed.intents.clone(),
        unknown: parsed.unknown.clone(),
        source: Some(text),
    });
    Ok(SceneResult { engine: engine.into(), parsed })
}

#[tauri::command]
pub fn ai_status(state: State<'_, Arc<AppState>>) -> AiStatus {
    let s = state.settings.lock().unwrap();
    AiStatus { has_api_key: s.api_key().is_some(), model: s.ai_model.clone().unwrap_or_else(|| DEFAULT_MODEL.into()) }
}

#[tauri::command]
pub fn set_api_key(app: AppHandle, state: State<'_, Arc<AppState>>, key: String, model: Option<String>) -> Result<(), String> {
    let mut s = state.settings.lock().unwrap();
    s.anthropic_api_key = Some(key);
    if model.is_some() {
        s.ai_model = model;
    }
    s.save(&app)
}
