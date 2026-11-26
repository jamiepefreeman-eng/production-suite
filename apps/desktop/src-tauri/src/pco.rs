//! Planning Center Services → a service in this app.
//!
//! Sign-in: a Personal Access Token (Application ID + Secret) the church admin makes at
//! api.planningcenteronline.com/oauth/applications → "Personal Access Tokens". Sent as HTTP Basic auth.
//! Kept in this computer's settings (like the AI key — TODO OS keychain).
//!
//! API (JSON:API, https://api.planningcenteronline.com/services/v2):
//!   /service_types                                     → names
//!   /service_types/{st}/plans?filter=future&order=sort_date
//!   /service_types/{st}/plans/{p}/items?include=song,arrangement
//!     item: title, item_type ("song" | "header" | "media" | "item"), sequence, key_name
//!     song: title, ccli_number, author, copyright        arrangement: name, lyrics, chord_chart, sequence[]
//! The field names are from Planning Center's public API docs — VERIFY against a real account.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, State};

const API: &str = "https://api.planningcenteronline.com/services/v2";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct PcoCredentials {
    pub app_id: String,
    pub secret: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct PcoStatus {
    pub signed_in: bool,
    pub app_id: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct PcoServiceType {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct PcoPlan {
    pub id: String,
    pub title: String,
    /// As Planning Center writes it ("December 7, 2025").
    pub dates: String,
    pub series: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PcoItemKind {
    Song,
    Header,
    Item,
    Media,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct PcoItem {
    pub kind: PcoItemKind,
    pub title: String,
    pub key: String,
    pub ccli: Option<String>,
    pub authors: String,
    pub copyright: String,
    pub arrangement: String,
    /// Arrangement lyrics with section headings ("Verse 1", "CHORUS"…), if the church entered them.
    pub lyrics: String,
    /// Section order of the arrangement, e.g. ["Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge"].
    pub sequence: Vec<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct PcoPlanImport {
    pub title: String,
    pub dates: String,
    pub items: Vec<PcoItem>,
}

fn s(v: &Value, k: &str) -> String {
    match &v["attributes"][k] {
        Value::String(x) => x.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

pub fn parse_service_types(doc: &Value) -> Vec<PcoServiceType> {
    doc["data"].as_array().map(|a| a.iter().map(|t| PcoServiceType { id: t["id"].as_str().unwrap_or("").into(), name: s(t, "name") }).collect()).unwrap_or_default()
}

pub fn parse_plans(doc: &Value) -> Vec<PcoPlan> {
    doc["data"]
        .as_array()
        .map(|a| a.iter().map(|p| PcoPlan { id: p["id"].as_str().unwrap_or("").into(), title: s(p, "title"), dates: s(p, "dates"), series: s(p, "series_title") }).collect())
        .unwrap_or_default()
}

/// Chord chart → lyrics: drop chord-only lines and [bracketed] / inline chords.
fn chart_to_lyrics(chart: &str) -> String {
    let chordish = |w: &str| {
        let w = w.trim_matches(|c| c == '(' || c == ')' || c == '|');
        !w.is_empty() && w.len() <= 7 && w.chars().next().is_some_and(|c| ('A'..='G').contains(&c)) && w.chars().skip(1).all(|c| "#bmajsudi0123456789/+°ABCDEFG".contains(c))
    };
    chart
        .lines()
        .filter_map(|l| {
            let no_br: String = {
                let mut out = String::new();
                let mut d = 0;
                for c in l.chars() {
                    match c {
                        '[' => d += 1,
                        ']' if d > 0 => d -= 1,
                        _ if d == 0 => out.push(c),
                        _ => {}
                    }
                }
                out
            };
            let words: Vec<&str> = no_br.split_whitespace().collect();
            if !words.is_empty() && words.iter().all(|w| chordish(w)) {
                None
            } else {
                Some(no_br.trim_end().to_string())
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn parse_items(plan: &Value, items: &Value) -> PcoPlanImport {
    let included = items["included"].as_array().cloned().unwrap_or_default();
    let find = |kind: &str, id: &Value| included.iter().find(|x| x["type"] == kind && &x["id"] == id).cloned();
    let mut out = vec![];
    for it in items["data"].as_array().cloned().unwrap_or_default() {
        let kind = match s(&it, "item_type").as_str() {
            "song" => PcoItemKind::Song,
            "header" => PcoItemKind::Header,
            "media" => PcoItemKind::Media,
            _ => PcoItemKind::Item,
        };
        let song = find("Song", &it["relationships"]["song"]["data"]["id"]);
        let arr = find("Arrangement", &it["relationships"]["arrangement"]["data"]["id"]);
        let lyrics = arr.as_ref().map(|a| s(a, "lyrics")).filter(|l| !l.trim().is_empty()).or_else(|| arr.as_ref().map(|a| chart_to_lyrics(&s(a, "chord_chart")))).unwrap_or_default();
        let sequence = arr
            .as_ref()
            .and_then(|a| a["attributes"]["sequence"].as_array().cloned())
            .map(|v| v.iter().filter_map(|x| x.as_str().map(|x| x.to_string())).collect())
            .unwrap_or_default();
        let ccli = song.as_ref().map(|x| s(x, "ccli_number")).filter(|c| !c.is_empty() && c != "0");
        out.push(PcoItem {
            title: song.as_ref().map(|x| s(x, "title")).filter(|t| !t.is_empty()).unwrap_or_else(|| s(&it, "title")),
            kind,
            key: s(&it, "key_name"),
            ccli,
            authors: song.as_ref().map(|x| s(x, "author")).unwrap_or_default(),
            copyright: song.as_ref().map(|x| s(x, "copyright")).unwrap_or_default(),
            arrangement: arr.as_ref().map(|a| s(a, "name")).unwrap_or_default(),
            lyrics,
            sequence,
        });
    }
    PcoPlanImport { title: s(&plan["data"], "title"), dates: s(&plan["data"], "dates"), items: out }
}

fn creds(state: &AppState) -> Result<PcoCredentials, String> {
    state.settings.lock().unwrap().pco.clone().filter(|c| !c.app_id.is_empty() && !c.secret.is_empty()).ok_or_else(|| "Sign in to Planning Center first".to_string())
}

async fn get(c: &PcoCredentials, path: &str) -> Result<Value, String> {
    let resp = reqwest::Client::new()
        .get(format!("{API}{path}"))
        .basic_auth(&c.app_id, Some(&c.secret))
        .header("User-Agent", "ProductionSuite")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Planning Center: {e}"))?;
    match resp.status().as_u16() {
        200 => resp.json().await.map_err(|e| e.to_string()),
        401 | 403 => Err("Planning Center didn't accept the Application ID / Secret".into()),
        code => Err(format!("Planning Center error {code}: {}", resp.text().await.unwrap_or_default().chars().take(200).collect::<String>())),
    }
}

#[tauri::command]
pub fn pco_status(state: State<'_, Arc<AppState>>) -> PcoStatus {
    let c = state.settings.lock().unwrap().pco.clone().unwrap_or_default();
    PcoStatus { signed_in: !c.app_id.is_empty() && !c.secret.is_empty(), app_id: c.app_id }
}

/// Check and save the token (empty = sign out).
#[tauri::command]
pub async fn pco_sign_in(app: AppHandle, state: State<'_, Arc<AppState>>, app_id: String, secret: String) -> Result<Vec<PcoServiceType>, String> {
    let c = PcoCredentials { app_id: app_id.trim().into(), secret: secret.trim().into() };
    if c.app_id.is_empty() {
        let mut st = state.settings.lock().unwrap();
        st.pco = None;
        st.save(&app)?;
        return Ok(vec![]);
    }
    let types = parse_service_types(&get(&c, "/service_types?per_page=100").await?);
    let mut st = state.settings.lock().unwrap();
    st.pco = Some(c);
    st.save(&app)?;
    Ok(types)
}

#[tauri::command]
pub async fn pco_service_types(state: State<'_, Arc<AppState>>) -> Result<Vec<PcoServiceType>, String> {
    let c = creds(&state)?;
    Ok(parse_service_types(&get(&c, "/service_types?per_page=100").await?))
}

/// Upcoming plans (and the few most recent ones) of a service type.
#[tauri::command]
pub async fn pco_plans(state: State<'_, Arc<AppState>>, service_type: String) -> Result<Vec<PcoPlan>, String> {
    let c = creds(&state)?;
    let id: String = service_type.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let mut plans = parse_plans(&get(&c, &format!("/service_types/{id}/plans?filter=future&order=sort_date&per_page=12")).await?);
    let past = parse_plans(&get(&c, &format!("/service_types/{id}/plans?filter=past&order=-sort_date&per_page=4")).await?);
    plans.extend(past);
    Ok(plans)
}

#[tauri::command]
pub async fn pco_plan(state: State<'_, Arc<AppState>>, service_type: String, plan: String) -> Result<PcoPlanImport, String> {
    let c = creds(&state)?;
    let clean = |x: &str| x.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>();
    let (st, p) = (clean(&service_type), clean(&plan));
    let plan_doc = get(&c, &format!("/service_types/{st}/plans/{p}")).await?;
    let items = get(&c, &format!("/service_types/{st}/plans/{p}/items?include=song,arrangement&per_page=100")).await?;
    Ok(parse_items(&plan_doc, &items))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plan_items_map_to_songs_headers_and_items() {
        let plan = json!({ "data": { "id": "9", "type": "Plan", "attributes": { "title": "Christmas Eve", "dates": "December 24, 2026" } } });
        let items = json!({
            "data": [
                { "id": "1", "type": "Item", "attributes": { "title": "Pre-service", "item_type": "header", "sequence": 1 } },
                { "id": "2", "type": "Item", "attributes": { "title": "O Come All Ye Faithful", "item_type": "song", "key_name": "G", "sequence": 2 },
                  "relationships": { "song": { "data": { "type": "Song", "id": "55" } }, "arrangement": { "data": { "type": "Arrangement", "id": "77" } } } },
                { "id": "3", "type": "Item", "attributes": { "title": "Welcome & announcements", "item_type": "item", "sequence": 3 } },
                { "id": "4", "type": "Item", "attributes": { "title": "Silent Night", "item_type": "song" },
                  "relationships": { "song": { "data": { "type": "Song", "id": "56" } }, "arrangement": { "data": { "type": "Arrangement", "id": "78" } } } }
            ],
            "included": [
                { "type": "Song", "id": "55", "attributes": { "title": "O Come All Ye Faithful", "ccli_number": 31054, "author": "John Francis Wade", "copyright": "Public Domain" } },
                { "type": "Arrangement", "id": "77", "attributes": { "name": "Default", "lyrics": "VERSE 1\nO come all ye faithful\n\nCHORUS\nO come let us adore Him", "sequence": ["Verse 1", "Chorus", "Chorus"] } },
                { "type": "Song", "id": "56", "attributes": { "title": "Silent Night", "ccli_number": 27693 } },
                { "type": "Arrangement", "id": "78", "attributes": { "name": "Acoustic", "lyrics": "", "chord_chart": "VERSE 1\nG        D7    G\nSilent [G]night, holy night", "sequence": [] } }
            ]
        });
        let r = parse_items(&plan, &items);
        assert_eq!(r.title, "Christmas Eve");
        assert_eq!(r.items.len(), 4);
        assert_eq!(r.items[0].kind, PcoItemKind::Header);
        let s = &r.items[1];
        assert_eq!((s.kind.clone(), s.ccli.as_deref(), s.key.as_str()), (PcoItemKind::Song, Some("31054"), "G"));
        assert_eq!(s.sequence, vec!["Verse 1", "Chorus", "Chorus"]);
        assert!(s.lyrics.contains("O come all ye faithful"));
        assert_eq!(r.items[2].kind, PcoItemKind::Item);
        // Chord chart fallback drops chords.
        assert_eq!(r.items[3].lyrics, "VERSE 1\nSilent night, holy night");
        let p = suite_core::presenter::songselect::import_song(1, &s.lyrics, &s.title, 4);
        assert_eq!(p.slides.iter().map(|x| x.label.as_str()).collect::<Vec<_>>(), vec!["Verse 1", "Chorus"]);
    }

    #[test]
    fn plans_and_types() {
        let t = parse_service_types(&json!({ "data": [{ "id": "1", "attributes": { "name": "Sunday AM" } }] }));
        assert_eq!(t, vec![PcoServiceType { id: "1".into(), name: "Sunday AM".into() }]);
        let p = parse_plans(&json!({ "data": [{ "id": "5", "attributes": { "title": null, "dates": "Dec 7", "series_title": "Advent" } }] }));
        assert_eq!(p[0].series, "Advent");
        assert_eq!(p[0].title, "");
    }
}
