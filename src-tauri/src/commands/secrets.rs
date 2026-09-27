const SERVICE: &str = "com.dungnt.dntnote";

/// Accepts only `provider:<id>` keys with a safe, bounded id.
pub fn validate_key(key: &str) -> Result<(), String> {
    let ok = key.strip_prefix("provider:").is_some_and(|id| {
        !id.is_empty()
            && id.len() <= 64
            && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    });
    if ok {
        Ok(())
    } else {
        Err(format!("Không lưu được khóa bảo mật: khóa không hợp lệ ({key})"))
    }
}

fn err(e: impl std::fmt::Display) -> String {
    format!("Không lưu được khóa bảo mật: {e}")
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    validate_key(key)?;
    keyring::Entry::new(SERVICE, key).map_err(err)
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(err)
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(err(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_key;

    #[test]
    fn accepts_provider_keys() {
        assert!(validate_key("provider:p_abc123").is_ok());
        assert!(validate_key("provider:A-b_9").is_ok());
        assert!(validate_key(&format!("provider:{}", "a".repeat(64))).is_ok());
    }

    #[test]
    fn rejects_other_keys() {
        for k in ["", "provider:", "provider:a b", "provider:a/b", "other:x", "PROVIDER:x", "provider:é"] {
            assert!(validate_key(k).is_err(), "{k}");
        }
        assert!(validate_key(&format!("provider:{}", "a".repeat(65))).is_err());
        assert!(validate_key("bad").unwrap_err().starts_with("Không lưu được khóa bảo mật"));
    }
}
