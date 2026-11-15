//! `we-legacy` — the legacy screen-store adapter (E3c-6).
//!
//! Old templates read the screen through the store names WE gave them:
//! `routeStore`, `shellStore`, `themeStore` and `spaceStore.spacePath`.
//! Core binds only `screen` — the live [`ScreenView`]. This adapter binds
//! each legacy name once, as a face over the bag's root slot, and serves
//! every member read from the live state at read time:
//!
//! - a screen member (`routeStore.params.x`, `spaceStore.spacePath`,
//!   `shellStore.panels.inspector`, `themeStore.themeFork`) reads the
//!   view's current snapshot — a screen change is the very next answer;
//! - a data member (`spaceStore.members`, `themeStore.builtInThemes`)
//!   reads the bag's root *base* — whatever `set_root` last wrote.
//!
//! Nothing is captured at install: there is no base to go stale, so the
//! runtime-rebind residual the design's §5.1 calls out cannot come back —
//! `set_root("spaceStore", …)` then a screen change then a read answers
//! the new base and the new screen fact together.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use we_expr::{Namespace, Value};
use we_template::{ScreenView, StoreBag};

/// `member` → canonical allocation, for the members a face synthesizes —
/// moved from `StoreBag` (E3c-6): a face's overlay answers rebuild as
/// fresh maps and callables every snapshot, but while their content holds
/// the SAME value must answer, or a tracked initial's dep would move on an
/// unrelated screen change (R6-1).
#[derive(Debug, Clone, Default)]
struct Canon {
    map: Arc<Mutex<HashMap<Arc<str>, Value>>>,
}

impl Canon {
    /// `candidate`, interned: while the content holds, the canonical
    /// allocation answers; a changed answer replaces it.
    fn get(&self, member: &str, candidate: Value) -> Value {
        let key: Arc<str> = member.into();
        let Ok(mut map) = self.map.lock() else {
            return candidate;
        };
        match map.get(&key) {
            Some(held) if we_template::content_eq(held, &candidate) => held.clone(),
            _ => {
                map.insert(key, candidate.clone());
                candidate
            }
        }
    }
}

/// One key off a `Value` that may be a namespace.
fn read_key(value: &Value, key: &str) -> Value {
    match value {
        Value::Namespace(ns) => ns.get(key),
        _ => Value::Undefined,
    }
}

/// `routeStore`/`shellStore`/`themeStore` — the screen's member answers on
/// top, the store's own members underneath. The overlay is the view's
/// `nav`/`shell`/`theme` member read at call time; the base is the bag's
/// live root for the same name — `set_root` swaps it and the face answers
/// the new base on its very next read.
#[derive(Debug)]
struct MergedNs {
    bag: Arc<StoreBag>,
    /// The bag root this face sits over (`routeStore`, …).
    name: &'static str,
    /// The [`ScreenView`] member this face overlays (`nav`/`shell`/`theme`).
    member: &'static str,
    /// Reads the overlay owns even when its answer is `Undefined`/`null`.
    owned: &'static [&'static str],
    view: ScreenView,
    /// Canonical allocations for the overlay's answers — synthesized
    /// screen members only; forwarded data reads stay live.
    canon: Canon,
}

impl Namespace for MergedNs {
    fn get(&self, key: &str) -> Value {
        let over = read_key(&self.view.get(self.member), key);
        if self.owned.contains(&key) || !matches!(over, Value::Undefined) {
            return self.canon.get(key, over);
        }
        read_key(
            &self.bag.root_base(self.name).unwrap_or(Value::Undefined),
            key,
        )
    }

    fn keys(&self) -> Vec<Arc<str>> {
        let mut keys = match self.bag.root_base(self.name) {
            Some(Value::Namespace(ns)) => ns.keys(),
            _ => Vec::new(),
        };
        if let Value::Namespace(ns) = self.view.get(self.member) {
            for k in ns.keys() {
                if !keys.iter().any(|e| e == &k) {
                    keys.push(k);
                }
            }
        }
        keys
    }
}

/// `spaceStore` merged with `spacePath` — the store's members underneath,
/// the screen's reading of where we are on top. `spacePath` is a screen
/// fact (`/space/<id>` inside a space, null out); a data root cannot
/// carry it because it changes with the route.
#[derive(Debug)]
struct SpaceStoreNs {
    bag: Arc<StoreBag>,
    view: ScreenView,
    /// Canonical allocation for `spacePath` — the screen fact; every other
    /// member is the base store's data and reads live.
    canon: Canon,
}

impl SpaceStoreNs {
    /// The live `spacePath` — the view's `nav` member, read now.
    fn space_path(&self) -> Value {
        read_key(&self.view.get("nav"), "spacePath")
    }
}

impl Namespace for SpaceStoreNs {
    fn get(&self, key: &str) -> Value {
        if key == "spacePath" {
            return self.canon.get(key, self.space_path());
        }
        read_key(
            &self.bag.root_base("spaceStore").unwrap_or(Value::Undefined),
            key,
        )
    }

    fn keys(&self) -> Vec<Arc<str>> {
        let mut keys = match self.bag.root_base("spaceStore") {
            Some(Value::Namespace(ns)) => ns.keys(),
            _ => Vec::new(),
        };
        if !keys.iter().any(|k| k.as_ref() == "spacePath") {
            keys.push("spacePath".into());
        }
        keys
    }
}

/// The installed adapter: one face per legacy store name over the shared
/// `screen` view. [`LegacyBindings::install`] binds them; the handle keeps
/// the bag and view for callers that report what was installed — and is
/// where the E3c-8a `BindingSource` impl lands later.
#[derive(Debug)]
pub struct LegacyBindings {
    bag: Arc<StoreBag>,
    view: ScreenView,
}

/// The legacy names this adapter serves — the screen stores a bundle may
/// read before conversion (E3c-9 rewrites them to `screen.*`/`legacy.*`).
pub const LEGACY_STORES: [&str; 4] = ["routeStore", "shellStore", "themeStore", "spaceStore"];

impl LegacyBindings {
    /// Bind the legacy screen stores over `view`, once: `routeStore` ←
    /// `nav`, `shellStore` ← `shell`, `themeStore` ← `theme`, and
    /// `spaceStore.spacePath` over the bag's `spaceStore` base. Every face
    /// reads live — rebind is never needed and stacking is impossible
    /// (each name holds exactly one face).
    pub fn install(bag: &Arc<StoreBag>, view: &ScreenView) -> Self {
        let route = MergedNs {
            bag: bag.clone(),
            name: "routeStore",
            member: "nav",
            owned: &[
                "params",
                "templateSegments",
                "segments",
                "currentPath",
                "page",
                "href",
                "spacePath",
            ],
            view: view.clone(),
            canon: Canon::default(),
        };
        let shell = MergedNs {
            bag: bag.clone(),
            name: "shellStore",
            member: "shell",
            owned: &[
                "activeShellView",
                "spaceSettingsOpen",
                "spaceSettingsTab",
                "collapsedLanes",
                "layoutDirty",
                "panelsHidden",
                "panelMaximised",
                "createSpaceOpen",
                "joinSpaceOpen",
                "panels",
            ],
            view: view.clone(),
            canon: Canon::default(),
        };
        // `themeFork` is always the screen's call (`null` = no fork); an
        // unset `currentThemeId` reads Undefined and defers to the base.
        let theme = MergedNs {
            bag: bag.clone(),
            name: "themeStore",
            member: "theme",
            owned: &["themeFork"],
            view: view.clone(),
            canon: Canon::default(),
        };
        bag.install_adapter("routeStore", Value::namespace(route));
        bag.install_adapter("shellStore", Value::namespace(shell));
        bag.install_adapter("themeStore", Value::namespace(theme));
        bag.install_adapter(
            "spaceStore",
            Value::namespace(SpaceStoreNs {
                bag: bag.clone(),
                view: view.clone(),
                canon: Canon::default(),
            }),
        );
        Self {
            bag: bag.clone(),
            view: view.clone(),
        }
    }

    /// The bag the faces are bound over.
    pub fn bag(&self) -> &Arc<StoreBag> {
        &self.bag
    }

    /// The live view the faces read screen members through.
    pub fn view(&self) -> &ScreenView {
        &self.view
    }
}
