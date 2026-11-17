//! [`StoreMap`]: which store members the offline layer has an answer for.
//!
//! The schema is the one `storeMap.json` (task M1) will ship, documented in the
//! shared architecture brief §5:
//!
//! ```json
//! {
//!   "version": 1,
//!   "screen": { "store": "routeStore", "members": { "…": true } },
//!   "members": {
//!     "recordStore.createRecord": { "kind": "modelWrite", "call": "record.create" },
//!     "workflowStore.canEdit":    { "kind": "derived", "expr": "…" }
//!   }
//! }
//! ```
//!
//! `kind` decides who serves the member offline:
//!
//! | kind | offline meaning |
//! |---|---|
//! | `screen` | the screen supplies it (`routeStore.params`, `shellStore.*`) — no row needed |
//! | `derived` | a store-side computation; `native` names a built-in, `expr` an expression |
//! | `modelRead` | a model read; `query` names a snapshot query, `native` a built-in |
//! | `modelWrite` | a write — `call` names the `$invoke` target it maps to (never runs) |
//! | `flow` | a flow — never runs offline |
//! | `command` | a host command — never runs offline |
//! | `widgetInternal` | widget-local bookkeeping — falls back to the snapshot |
//! | `deferred` | known member with no offline answer yet — falls back to the snapshot |
//!
//! A member with no row falls back to the snapshot. Only `derived`/`modelRead`
//! rows carry an offline implementation here (`native` or `expr`); the rest
//! parse, and the loader leaves them alone.
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

/// The member rows, keyed `"store.member"` in authored order.
#[derive(Debug, Clone)]
pub struct StoreMap {
    pub version: u64,
    /// The `screen` section, kept raw — the screen knows its own members.
    pub screen: Value,
    /// `store.member` → row.
    pub members: BTreeMap<String, MemberRow>,
}

/// One `members` entry. The fields past `kind` stay raw on [`MemberRow::raw`];
/// the accessors below read the ones the offline layer uses.
#[derive(Debug, Clone)]
pub struct MemberRow {
    pub kind: MemberKind,
    /// The whole row, untouched — recipes (`call`, `op`, `live`, `stage`,
    /// `path`, `owner`) travel with it.
    pub raw: Map<String, Value>,
}

/// The `kind` field. Anything else is a parse error naming the member.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberKind {
    Screen,
    Derived,
    ModelRead,
    ModelWrite,
    Flow,
    Command,
    WidgetInternal,
    Deferred,
}

const KINDS: [(&str, MemberKind); 8] = [
    ("screen", MemberKind::Screen),
    ("derived", MemberKind::Derived),
    ("modelRead", MemberKind::ModelRead),
    ("modelWrite", MemberKind::ModelWrite),
    ("flow", MemberKind::Flow),
    ("command", MemberKind::Command),
    ("widgetInternal", MemberKind::WidgetInternal),
    ("deferred", MemberKind::Deferred),
];

#[derive(Deserialize)]
struct WireStoreMap {
    #[serde(default)]
    version: Option<u64>,
    #[serde(default)]
    screen: Value,
    #[serde(default)]
    members: Map<String, Value>,
}

impl StoreMap {
    /// Parse a store map document. An unknown `kind` is an error naming the
    /// member it was found on; malformed members likewise name themselves.
    pub fn parse(text: &str) -> Result<StoreMap, String> {
        let wire: WireStoreMap =
            serde_json::from_str(text).map_err(|e| format!("store map: {e}"))?;
        // Version 1 is the only schema this reader knows — an omitted version
        // is a pre-version file and stays accepted as 0; anything newer
        // refuses rather than half-loading rows it cannot interpret.
        if let Some(v) = wire.version {
            if v > 1 {
                return Err(format!(
                    "store map: unsupported version {v} (reader knows 1)"
                ));
            }
        }
        let mut members = BTreeMap::new();
        for (path, raw) in &wire.members {
            let row = raw
                .as_object()
                .ok_or_else(|| format!("store map: member {path}: row is not an object"))?;
            let kind_text = row
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("store map: member {path}: missing kind"))?;
            let kind = KINDS
                .iter()
                .find_map(|(name, k)| (*name == kind_text).then_some(*k))
                .ok_or_else(|| format!("store map: member {path}: unknown kind {kind_text}"))?;
            members.insert(
                path.clone(),
                MemberRow {
                    kind,
                    raw: row.clone(),
                },
            );
        }
        Ok(StoreMap {
            version: wire.version.unwrap_or(0),
            screen: wire.screen,
            members,
        })
    }

    /// Read and parse a store map file. Native-only: the library never touches
    /// the filesystem on wasm.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn load(path: impl AsRef<std::path::Path>) -> Result<StoreMap, String> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path)
            .map_err(|e| format!("store map: cannot read {}: {e}", path.display()))?;
        StoreMap::parse(&text)
    }
}

impl MemberRow {
    /// `native` — the name of a built-in implementation.
    pub fn native(&self) -> Option<&str> {
        self.raw.get("native").and_then(Value::as_str)
    }

    /// `expr` — a template expression the offline layer evaluates against the bag.
    pub fn expr(&self) -> Option<&str> {
        self.raw.get("expr").and_then(Value::as_str)
    }

    /// `query` — the name of the snapshot query a `modelRead` maps to, when the
    /// row names one.
    pub fn query(&self) -> Option<&str> {
        self.raw.get("query").and_then(Value::as_str)
    }

    /// `call` — the `$invoke` target a `modelWrite`/`command` maps to.
    pub fn call(&self) -> Option<&str> {
        self.raw.get("call").and_then(Value::as_str)
    }

    /// `stage` — a `flow` row's stage names.
    pub fn stage(&self) -> Vec<&str> {
        self.raw
            .get("stage")
            .and_then(Value::as_array)
            .map(|stages| stages.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default()
    }
}

/// Split `"store.member"` at the LAST dot — stores nest (`modules.call.goToCall`
/// is the member `goToCall` of the store `modules.call`).
pub(crate) fn split_member(path: &str) -> (&str, &str) {
    match path.rsplit_once('.') {
        Some((store, member)) => (store, member),
        None => (path, ""),
    }
}
