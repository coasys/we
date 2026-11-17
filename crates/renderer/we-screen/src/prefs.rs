//! Tier 4: what this device remembers — `localStorage` keys on web, a JSON
//! file on desktop (screen-state.md §4.7, rule 10). Keys are plain strings;
//! values are JSON text, exactly what the app stored.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

/// Tier 4 as `ScreenState` holds it: the parsed values on top of whichever
/// [`PrefStore`] the platform supplied (screen-state.md §4.5). Reads go to
/// the store once, then to the map; a stored text that is not JSON reads as
/// absent — a corrupt entry is nobody's preference.
pub struct DevicePrefs {
    store: Box<dyn PrefStore>,
    values: RefCell<BTreeMap<String, serde_json::Value>>,
}

impl DevicePrefs {
    /// Preferences over `store` — `MemoryPrefs`, `FilePrefs`, localStorage.
    pub fn new(store: Box<dyn PrefStore>) -> DevicePrefs {
        DevicePrefs {
            store,
            values: RefCell::new(BTreeMap::new()),
        }
    }

    /// The stored value for `key`, or `None`.
    pub fn get(&self, key: &str) -> Option<serde_json::Value> {
        if let Some(v) = self.values.borrow().get(key) {
            return Some(v.clone());
        }
        let v: serde_json::Value = self
            .store
            .get(key)
            .and_then(|text| serde_json::from_str(&text).ok())?;
        self.values.borrow_mut().insert(key.to_string(), v.clone());
        Some(v)
    }

    /// Write `value` under `key` — `None` removes it. The store holds the
    /// JSON text; a no-change write is a no-op.
    pub fn set(&mut self, key: &str, value: Option<&serde_json::Value>) -> crate::Changed {
        let text = value.map(|v| serde_json::to_string(v).unwrap_or_default());
        let changed = self.store.set(key, text.as_deref());
        match value {
            Some(v) => {
                self.values.borrow_mut().insert(key.to_string(), v.clone());
            }
            None => {
                self.values.borrow_mut().remove(key);
            }
        }
        changed
    }
}

/// Where device preferences live.
pub trait PrefStore {
    /// The stored JSON text for `key`, or `None`.
    fn get(&self, key: &str) -> Option<String>;
    /// Store `value` under `key`; `None` removes it. Returns `Changed` — a
    /// write of the same value is a no-op.
    fn set(&mut self, key: &str, value: Option<&str>) -> crate::Changed;
}

/// In-memory preferences — tests, and the fallback before persistence is
/// wired.
#[derive(Debug, Default)]
pub struct MemoryPrefs {
    map: HashMap<String, String>,
}

impl PrefStore for MemoryPrefs {
    fn get(&self, key: &str) -> Option<String> {
        self.map.get(key).cloned()
    }

    fn set(&mut self, key: &str, value: Option<&str>) -> crate::Changed {
        let changed = value != self.map.get(key).map(String::as_str);
        match value {
            Some(v) => {
                self.map.insert(key.to_string(), v.to_string());
            }
            None => {
                self.map.remove(key);
            }
        }
        if changed {
            crate::Changed::Yes
        } else {
            crate::Changed::No
        }
    }
}

/// Desktop preferences: one JSON object on disk. Reads go through memory
/// after load; writes flush the whole file (preferences are few and small).
/// A corrupt file reads as empty — preferences are never worth a panic.
#[derive(Debug)]
pub struct FilePrefs {
    path: PathBuf,
    mem: MemoryPrefs,
}

impl FilePrefs {
    /// Load `path`; a missing or corrupt file starts empty.
    pub fn load(path: impl Into<PathBuf>) -> FilePrefs {
        let path = path.into();
        let mut mem = MemoryPrefs::default();
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(serde_json::Value::Object(obj)) = serde_json::from_str(&text) {
                for (k, v) in obj {
                    if let serde_json::Value::String(s) = v {
                        mem.map.insert(k, s);
                    }
                }
            }
        }
        FilePrefs { path, mem }
    }

    fn flush(&self) {
        let obj: serde_json::Map<String, serde_json::Value> = self
            .mem
            .map
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
            .collect();
        if let Ok(text) = serde_json::to_string(&serde_json::Value::Object(obj)) {
            if let Some(parent) = self.path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&self.path, text);
        }
    }
}

impl PrefStore for FilePrefs {
    fn get(&self, key: &str) -> Option<String> {
        self.mem.get(key)
    }

    fn set(&mut self, key: &str, value: Option<&str>) -> crate::Changed {
        let changed = self.mem.set(key, value);
        if changed.changed() {
            self.flush();
        }
        changed
    }
}

/// The web backend: `window.localStorage` — wasm only.
#[cfg(target_arch = "wasm32")]
pub struct LocalStoragePrefs {
    storage: web_sys::Storage,
}

#[cfg(target_arch = "wasm32")]
impl LocalStoragePrefs {
    /// `window.localStorage`; `None` when there is no window.
    pub fn new() -> Option<LocalStoragePrefs> {
        web_sys::window()?
            .local_storage()
            .ok()?
            .map(|storage| LocalStoragePrefs { storage })
    }
}

#[cfg(target_arch = "wasm32")]
impl PrefStore for LocalStoragePrefs {
    fn get(&self, key: &str) -> Option<String> {
        self.storage.get_item(key).ok().flatten()
    }

    fn set(&mut self, key: &str, value: Option<&str>) -> crate::Changed {
        let changed = value != self.get(key).as_deref();
        match value {
            Some(v) => {
                let _ = self.storage.set_item(key, v);
            }
            None => {
                let _ = self.storage.remove_item(key);
            }
        }
        if changed {
            crate::Changed::Yes
        } else {
            crate::Changed::No
        }
    }
}

impl FilePrefs {
    /// The path this store flushes to — for callers that display it.
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}
