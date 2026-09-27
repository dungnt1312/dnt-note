use notes_core::store::NotesStore;
use serde_json::{json, Value};

pub const PROTOCOL_VERSION: &str = "2024-11-05";

/// Tool definitions exposed over MCP (parity + open_note extension).
pub fn tool_definitions() -> Value {
    json!({
        "tools": [
            {
                "name": "list_notes",
                "description": "Liệt kê ghi chú DNT Note (mới nhất trước, meta không body).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "offset": { "type": "integer", "description": "Bỏ qua N ghi chú đầu" },
                        "limit": { "type": "integer", "description": "Số lượng (mặc định 20)" }
                    }
                }
            },
            {
                "name": "search_notes",
                "description": "Tìm ghi chú theo từ khóa (title + body).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "limit": { "type": "integer" }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "read_note",
                "description": "Đọc nội dung ghi chú (hỗ trợ offset/limit ký tự cho note dài).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "offset": { "type": "integer", "description": "Vị trí ký tự bắt đầu" },
                        "limit": { "type": "integer", "description": "Số ký tự tối đa (mặc định 20000)" }
                    },
                    "required": ["id"]
                }
            },
            {
                "name": "create_note",
                "description": "Tạo ghi chú mới (markdown + tags).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "body": { "type": "string" },
                        "tags": { "type": "array", "items": { "type": "string" } }
                    },
                    "required": ["title"]
                }
            },
            {
                "name": "update_note",
                "description": "Sửa ghi chú (chỉ gửi trường cần đổi).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "title": { "type": "string" },
                        "body": { "type": "string" },
                        "tags": { "type": "array", "items": { "type": "string" } },
                        "pinned": { "type": "boolean" }
                    },
                    "required": ["id"]
                }
            },
            {
                "name": "delete_note",
                "description": "Xóa ghi chú (chuyển vào thùng rác, app có thể hoàn tác).",
                "inputSchema": {
                    "type": "object",
                    "properties": { "id": { "type": "string" } },
                    "required": ["id"]
                }
            },
            {
                "name": "open_note",
                "description": "Mở ghi chú trong app DNT Note (cửa sổ chính focus tới note). Trả URL scheme dntnote://.",
                "inputSchema": {
                    "type": "object",
                    "properties": { "id": { "type": "string" } },
                    "required": ["id"]
                }
            }
        ]
    })
}

fn tool_text(result: Value) -> Value {
    json!({
        "content": [{ "type": "text", "text": serde_json::to_string(&result).unwrap_or_default() }]
    })
}

fn call_tool(store: &mut NotesStore, name: &str, args: &Value) -> Value {
    let s = |v: &Value| v.as_str().map(|x| x.to_string());
    match name {
        "list_notes" | "get_recent_notes" => {
            let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
            let notes = store.list();
            let total = notes.len();
            let page: Vec<Value> = notes
                .into_iter()
                .skip(offset)
                .take(limit.clamp(1, 50))
                .map(|n| json!({ "id": n.id, "title": n.title, "tags": n.tags, "pinned": n.pinned, "updated": n.updated, "snippet": n.snippet }))
                .collect();
            tool_text(json!({ "total": total, "notes": page }))
        }
        "search_notes" => {
            let query = s(&args["query"]).unwrap_or_default();
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;
            let notes: Vec<Value> = store
                .search(&query, limit.clamp(1, 50))
                .into_iter()
                .map(|n| json!({ "id": n.id, "title": n.title, "snippet": n.snippet }))
                .collect();
            tool_text(json!({ "query": query, "results": notes }))
        }
        "read_note" => {
            let id = s(&args["id"]).unwrap_or_default();
            let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20_000) as usize;
            match store.read_body_range(&id, offset, limit) {
                Ok((text, total)) => tool_text(json!({ "id": id, "totalChars": total, "offset": offset, "body": text })),
                Err(e) => tool_text(json!({ "error": e.to_string() })),
            }
        }
        "create_note" => {
            let title = s(&args["title"]).unwrap_or_else(|| "Untitled".into());
            let body = s(&args["body"]).unwrap_or_default();
            let tags: Vec<String> = args
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|t| t.as_str().map(|x| x.to_string())).collect())
                .unwrap_or_default();
            match store.create(&title, &body, tags) {
                Ok(note) => tool_text(json!({ "id": note.id, "title": note.title })),
                Err(e) => tool_text(json!({ "error": e.to_string() })),
            }
        }
        "update_note" => {
            let id = s(&args["id"]).unwrap_or_default();
            let patch = notes_core::note::NotePatch {
                title: args.get("title").and_then(|v| v.as_str()).map(|x| x.to_string()),
                body: args.get("body").and_then(|v| v.as_str()).map(|x| x.to_string()),
                tags: args.get("tags").and_then(|v| v.as_array()).map(|a| {
                    a.iter().filter_map(|t| t.as_str().map(|x| x.to_string())).collect()
                }),
                pinned: args.get("pinned").and_then(|v| v.as_bool()),
            };
            match store.update(&id, patch) {
                Ok(note) => tool_text(json!({ "id": note.id, "title": note.title, "updated": note.updated })),
                Err(e) => tool_text(json!({ "error": e.to_string() })),
            }
        }
        "delete_note" => {
            let id = s(&args["id"]).unwrap_or_default();
            match store.delete(&id) {
                Ok(()) => tool_text(json!({ "deleted": id, "note": "Đã chuyển vào thùng rác" })),
                Err(e) => tool_text(json!({ "error": e.to_string() })),
            }
        }
        "open_note" => {
            let id = s(&args["id"]).unwrap_or_default();
            tool_text(json!({
                "url": format!("dntnote://note/{id}"),
                "note": "Mở URL này để focus ghi chú trong app DNT Note."
            }))
        }
        other => tool_text(json!({ "error": format!("Unknown tool: {other}") })),
    }
}

/// Handle one JSON-RPC message. Returns the response (`None` for notifications).
pub fn handle_message(msg: &Value, store: &mut NotesStore) -> Option<Value> {
    let method = msg.get("method").and_then(|m| m.as_str())?;
    let id = msg.get("id").cloned();

    // Notifications have no id → no response.
    let is_notification = id.is_none();

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "dnt-note-mcp", "version": env!("CARGO_PKG_VERSION") }
        })),
        "notifications/initialized" | "initialized" => return None,
        "tools/list" => Ok(tool_definitions()),
        "tools/call" => {
            let params = msg.get("params").cloned().unwrap_or(json!({}));
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
            Ok(call_tool(store, name, &arguments))
        }
        "ping" => Ok(json!({})),
        other => Err(json!({
            "code": -32601,
            "message": format!("Method not found: {other}")
        })),
    };

    if is_notification {
        return None;
    }

    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store_with_one_note() -> (TempDir, NotesStore) {
        let tmp = TempDir::new().unwrap();
        let mut store = NotesStore::new(tmp.path().join("notes")).unwrap();
        store
            .create("Ghi chú MCP", "nội dung body dài để test", vec!["test".to_string()])
            .unwrap();
        (tmp, store)
    }

    fn initialize() -> Value {
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} })
    }

    #[test]
    fn initialize_returns_protocol_version() {
        let (_tmp, mut store) = store_with_one_note();
        let resp = handle_message(&initialize(), &mut store).unwrap();
        assert_eq!(resp["id"], 1);
        assert_eq!(resp["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(resp["result"]["serverInfo"]["name"], "dnt-note-mcp");
    }

    #[test]
    fn tools_list_has_seven_tools() {
        let (_tmp, mut store) = store_with_one_note();
        let msg = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" });
        let resp = handle_message(&msg, &mut store).unwrap();
        let names: Vec<&str> = resp["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(names.len(), 7);
        assert!(names.contains(&"open_note"));
    }

    #[test]
    fn tools_call_roundtrip_create_and_read() {
        let (_tmp, mut store) = store_with_one_note();
        let created = handle_message(
            &json!({
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": { "name": "create_note", "arguments": { "title": "Mới", "body": "nội dung mới" } }
            }),
            &mut store,
        )
        .unwrap();
        let created_text = created["result"]["content"][0]["text"].as_str().unwrap();
        let new_id: String =
            serde_json::from_str::<Value>(created_text).unwrap()["id"].as_str().unwrap().into();

        let read = handle_message(
            &json!({
                "jsonrpc": "2.0", "id": 4, "method": "tools/call",
                "params": { "name": "read_note", "arguments": { "id": new_id } }
            }),
            &mut store,
        )
        .unwrap();
        let read_text = read["result"]["content"][0]["text"].as_str().unwrap();
        let body: Value = serde_json::from_str(read_text).unwrap();
        assert_eq!(body["body"], "nội dung mới");
        assert_eq!(body["totalChars"], "nội dung mới".chars().count());
    }

    #[test]
    fn read_note_offset_slices() {
        let (_tmp, mut store) = store_with_one_note();
        let id = store.list()[0].id.clone();
        let resp = handle_message(
            &json!({
                "jsonrpc": "2.0", "id": 5, "method": "tools/call",
                "params": { "name": "read_note", "arguments": { "id": id, "offset": 0, "limit": 7 } }
            }),
            &mut store,
        )
        .unwrap();
        let text: Value = serde_json::from_str(resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(text["body"], "nội dun");
    }

    #[test]
    fn search_and_delete_work() {
        let (_tmp, mut store) = store_with_one_note();
        let id = store.list()[0].id.clone();

        let search = handle_message(
            &json!({
                "jsonrpc": "2.0", "id": 6, "method": "tools/call",
                "params": { "name": "search_notes", "arguments": { "query": "mcp" } }
            }),
            &mut store,
        )
        .unwrap();
        assert!(search["result"]["content"][0]["text"].as_str().unwrap().contains("Ghi chú MCP"));

        let deleted = handle_message(
            &json!({
                "jsonrpc": "2.0", "id": 7, "method": "tools/call",
                "params": { "name": "delete_note", "arguments": { "id": id } }
            }),
            &mut store,
        )
        .unwrap();
        assert!(deleted["result"]["content"][0]["text"].as_str().unwrap().contains("thùng rác"));
        assert!(store.list().is_empty());
    }

    #[test]
    fn open_note_returns_url_scheme() {
        let (_tmp, mut store) = store_with_one_note();
        let id = store.list()[0].id.clone();
        let resp = handle_message(
            &json!({
                "jsonrpc": "2.0", "id": 8, "method": "tools/call",
                "params": { "name": "open_note", "arguments": { "id": id } }
            }),
            &mut store,
        )
        .unwrap();
        let text: Value = serde_json::from_str(resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(text["url"], format!("dntnote://note/{id}"));
    }

    #[test]
    fn unknown_method_is_error() {
        let (_tmp, mut store) = store_with_one_note();
        let resp = handle_message(&json!({ "jsonrpc": "2.0", "id": 9, "method": "x/call" }), &mut store).unwrap();
        assert_eq!(resp["error"]["code"], -32601);
    }

    #[test]
    fn notifications_return_none() {
        let (_tmp, mut store) = store_with_one_note();
        assert!(handle_message(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), &mut store).is_none());
        assert!(handle_message(&json!({ "jsonrpc": "2.0", "method": "unknown/notification" }), &mut store).is_none());
    }
}
