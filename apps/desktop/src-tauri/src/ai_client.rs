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
    #[serde(default)]
    stop_reason: Option<String>,
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

// ───────────────────────────── AI media search

/// One media item as the AI sees it: name plus the measured look.
#[derive(Deserialize, Serialize, Clone)]
pub struct MediaSummary {
    pub id: u32,
    pub name: String,
    pub kind: String,
    pub description: String,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct MediaPick {
    pub id: u32,
    pub reason: String,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct MediaRanking {
    pub picks: Vec<MediaPick>,
    /// Title of the song / presentation the prompt names ("song one" → its title), if any.
    pub target: Option<String>,
}

const MEDIA_SYSTEM: &str = "You help a church production team choose background media (motion loops and stills) \
for songs. You get the request and a list of media items, each described by measured colour, brightness and \
motion, plus its file name. Pick up to 5 items that best match, best first, each with a short reason (one \
sentence, plain words, mention colour/motion). Only use ids from the list. If nothing fits well, return the \
closest few and say what's missing in the reason. Also say which song in the service the request is for, using \
the exact title from the service list (\"song one\" = the first song), or null if none is named.";

fn ranking_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "picks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": { "id": { "type": "integer" }, "reason": { "type": "string" } },
                    "required": ["id", "reason"],
                    "additionalProperties": false
                }
            },
            "target": { "type": ["string", "null"] }
        },
        "required": ["picks", "target"],
        "additionalProperties": false
    })
}

/// The request text for the media ranking (kept separate so it can be unit-tested).
fn media_request(prompt: &str, songs: &[String], media: &[MediaSummary]) -> String {
    let mut out = format!("Request: {prompt}\n\nSongs in the service, in order:\n");
    for (i, s) in songs.iter().enumerate() {
        out += &format!("{}. {s}\n", i + 1);
    }
    out += "\nMedia:\n";
    for m in media {
        out += &format!("- id {} · {} · \"{}\" · {}\n", m.id, m.kind, m.name, m.description);
    }
    out
}

/// Ask Claude to rank the media bin for a prompt such as
/// "for song one I want a fast upbeat background with movement, orange".
/// The app falls back to its own keyword ranking when this fails or there's no key.
#[tauri::command]
pub async fn ai_rank_media(
    state: State<'_, Arc<AppState>>,
    prompt: String,
    songs: Vec<String>,
    media: Vec<MediaSummary>,
) -> Result<MediaRanking, String> {
    let (key, model) = {
        let s = state.settings.lock().unwrap();
        (s.api_key(), s.ai_model.clone().unwrap_or_else(|| DEFAULT_MODEL.into()))
    };
    let key = key.ok_or("No API key — using the offline search")?;
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "system": MEDIA_SYSTEM,
        "output_config": { "format": { "type": "json_schema", "schema": ranking_schema() } },
        "messages": [{ "role": "user", "content": media_request(&prompt, &songs, &media) }],
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
    if api.stop_reason.as_deref() == Some("refusal") {
        return Err("The AI declined this request — using the offline search".into());
    }
    let text = api.content.into_iter().map(|c| c.text).collect::<Vec<_>>().join("");
    let mut r: MediaRanking = serde_json::from_str(extract_json(&text).ok_or("AI reply had no JSON")?).map_err(|e| format!("AI reply didn't match: {e}"))?;
    // Never trust ids we didn't send.
    r.picks.retain(|p| media.iter().any(|m| m.id == p.id));
    r.picks.dedup_by_key(|p| p.id);
    r.picks.truncate(5);
    Ok(r)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_request_lists_songs_and_media() {
        let m = vec![MediaSummary { id: 3, name: "Sunset Loop".into(), kind: "video".into(), description: "orange, fast motion".into() }];
        let r = media_request("song one orange", &["Way Maker".into(), "Goodness".into()], &m);
        assert!(r.contains("1. Way Maker") && r.contains("id 3") && r.contains("orange, fast motion"));
    }

    #[test]
    fn ranking_reply_parses() {
        let r: MediaRanking = serde_json::from_str(r#"{"picks":[{"id":3,"reason":"warm orange, lots of movement"}],"target":"Way Maker"}"#).unwrap();
        assert_eq!(r.picks[0].id, 3);
        assert_eq!(r.target.as_deref(), Some("Way Maker"));
        assert_eq!(ranking_schema()["required"][0], "picks");
    }
}
