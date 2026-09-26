use notes_core::store::write_atomic;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String, // "user" | "assistant" | "system" | "tool"
    #[serde(default)]
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub messages: Vec<ChatMessage>,
    pub updated: String, // RFC 3339
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMeta {
    pub id: String,
    pub title: String,
    pub updated: String,
}

fn chats_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("data dir: {e}"))?
        .join("chats");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir chats: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn list_chats(app: tauri::AppHandle) -> Result<Vec<ChatMeta>, String> {
    let dir = chats_dir(&app)?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("read chats: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(session) = serde_json::from_str::<ChatSession>(&raw) {
                out.push(ChatMeta {
                    id: session.id,
                    title: session.title,
                    updated: session.updated,
                });
            }
        }
    }
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(out)
}

#[tauri::command]
pub fn load_chat(app: tauri::AppHandle, id: String) -> Result<ChatSession, String> {
    let dir = chats_dir(&app)?;
    let raw = fs::read_to_string(dir.join(format!("{id}.json"))).map_err(|e| format!("read chat: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse chat: {e}"))
}

#[tauri::command]
pub fn save_chat(app: tauri::AppHandle, session: ChatSession) -> Result<(), String> {
    let dir = chats_dir(&app)?;
    let body = serde_json::to_string_pretty(&session).map_err(|e| format!("serialize: {e}"))?;
    write_atomic(&dir.join(format!("{}.json", session.id)), body.as_bytes())
        .map_err(|e| format!("write chat: {e}"))
}

#[tauri::command]
pub fn delete_chat(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = chats_dir(&app)?;
    let path = dir.join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("delete chat: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str) -> ChatSession {
        ChatSession {
            id: id.into(),
            title: "Phiên test".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "xin chào".into(),
                tool_calls: None,
                tool_call_id: None,
                name: None,
            }],
            updated: "2026-09-26T00:00:00Z".into(),
        }
    }

    #[test]
    fn session_json_round_trip() {
        let s = session("c1");
        let raw = serde_json::to_string(&s).unwrap();
        let parsed: ChatSession = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed, s);
        // camelCase on the wire
        assert!(raw.contains("\"toolCallId\"") || !raw.contains("tool_call_id"));
        assert!(raw.contains("\"id\":\"c1\""));
    }

    #[test]
    fn tool_fields_skip_when_absent() {
        let s = session("c2");
        let raw = serde_json::to_string(&s).unwrap();
        assert!(!raw.contains("toolCallId"));
        assert!(!raw.contains("toolCalls"));
    }
}
