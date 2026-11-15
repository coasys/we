//! `ScreenView` — the one live `screen` root (E3c-6).
//!
//! Screen state lives in `we-screen`'s [`ScreenState`]; a template reads it
//! through the `screen` root the [`crate::Runtime`] binds once per mount.
//! The view holds a [`ScreenBag`] snapshot and answers every member read
//! from the current one — a screen change swaps the snapshot, never the
//! binding, so the root's identity is stable (B10) and every read is
//! current (B8: a write the handler just made is visible to the next
//! token).
//!
//! [`apply_screen`] is the one write path: a [`ScreenOp`] lands on the
//! [`ScreenState`] and, only when it changed something, refreshes the
//! snapshot — the write is visible to the very next read.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use we_expr::{Namespace, Value};
use we_screen::{Changed, ScreenBag, ScreenOp, ScreenState};

/// `member` → canonical allocation, for the members the view synthesizes.
/// Moved here from `StoreBag` (E3c-6): the canonical-identity contract
/// belongs to the view that produces the values — `params`, `panels`,
/// `segments`, `templateSegments` rebuild as fresh maps and lists every
/// read, but while their content holds the SAME value must answer, or a
/// tracked initial's dep would move on an unrelated screen change (R6-1).
type CanonMap = Arc<Mutex<HashMap<Arc<str>, Value>>>;

/// The live `screen` root: one stable binding over the current
/// [`ScreenBag`] snapshot. [`Namespace::get`] reads the latest snapshot
/// every call — nothing here is captured at bind time.
#[derive(Debug, Clone)]
pub struct ScreenView {
    /// The snapshot member reads answer from — swapped on refresh.
    current: Arc<RwLock<Arc<ScreenBag>>>,
    /// The `ScreenState::version` the snapshot was taken at — a frame
    /// refreshes only when the handed state is ahead.
    version: Arc<AtomicU64>,
    canon: CanonMap,
}

impl ScreenView {
    /// An empty view — `screen.*` reads `Undefined` until the first
    /// refresh (the frame's first sync).
    pub fn new() -> Self {
        Self {
            current: Arc::new(RwLock::new(Arc::new(ScreenBag::empty()))),
            version: Arc::new(AtomicU64::new(u64::MAX)),
            canon: CanonMap::default(),
        }
    }

    /// The version the current snapshot was taken at.
    pub fn version(&self) -> u64 {
        self.version.load(Ordering::Relaxed)
    }

    /// Take `screen`'s current picture — called by the write path on a
    /// change, and by [`crate::Runtime::frame`] when the handed state is
    /// ahead (a `ScreenState` written outside `apply_screen` still lands).
    pub fn refresh(&self, screen: &ScreenState) {
        let snap = Arc::new(ScreenBag::snapshot(screen));
        if let Ok(mut current) = self.current.write() {
            *current = snap;
        }
        self.version.store(screen.version, Ordering::Relaxed);
    }

    /// `candidate`, interned: while the content holds, the canonical
    /// allocation answers — see [`crate::scope::content_eq`] for why the
    /// comparison is content, not identity.
    fn canon_get(&self, member: &str, candidate: Value) -> Value {
        let key: Arc<str> = member.into();
        let Ok(mut map) = self.canon.lock() else {
            return candidate;
        };
        match map.get(&key) {
            Some(held) if crate::scope::content_eq(held, &candidate) => held.clone(),
            _ => {
                map.insert(key, candidate.clone());
                candidate
            }
        }
    }
}

impl Default for ScreenView {
    fn default() -> Self {
        Self::new()
    }
}

/// One key off a `Value` that may be a namespace.
fn read_key(value: &Value, key: &str) -> Value {
    match value {
        Value::Namespace(ns) => ns.get(key),
        _ => Value::Undefined,
    }
}

impl Namespace for ScreenView {
    fn get(&self, key: &str) -> Value {
        let snap = self
            .current
            .read()
            .map(|s| s.clone())
            .unwrap_or_else(|_| Arc::new(ScreenBag::empty()));
        let candidate = match key {
            "nav" | "shell" | "theme" => snap.get(key),
            // nav's flat members — the route facts a template reads
            // (`screen.params.id`, `screen.currentPath`, `screen.spacePath`).
            "params" | "templateSegments" | "segments" | "currentPath" | "page" | "href"
            | "spacePath" => read_key(&snap.get("nav"), key),
            // shell's container members — `screen.panels.inspector`,
            // `screen.dialogs.create_space`.
            "panels" | "dialogs" => read_key(&snap.get("shell"), key),
            _ => return Value::Undefined,
        };
        self.canon_get(key, candidate)
    }

    fn keys(&self) -> Vec<Arc<str>> {
        [
            "nav",
            "params",
            "templateSegments",
            "segments",
            "currentPath",
            "page",
            "href",
            "spacePath",
            "shell",
            "panels",
            "dialogs",
            "theme",
        ]
        .into_iter()
        .map(Into::into)
        .collect()
    }
}

/// The one write path to screen state: `op` lands on `screen`; on a real
/// change the view's snapshot refreshes so the next read sees it. Writes
/// that move nothing (`Changed::No`) leave the snapshot alone.
pub(crate) fn apply_screen(screen: &mut ScreenState, view: &ScreenView, op: ScreenOp) -> Changed {
    let changed = screen.apply(op);
    if changed.changed() {
        view.refresh(screen);
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_screen::{ScreenSchema, ScreenState};

    fn screen(href: &str) -> ScreenState {
        ScreenState::desktop(ScreenSchema::default(), href)
    }

    fn read(view: &ScreenView, key: &str) -> Value {
        Namespace::get(view, key)
    }

    #[test]
    fn a_write_is_visible_to_the_next_read() {
        // B8 at the view: apply_screen refreshes the snapshot, so a read
        // after the write answers the new value — no frame in between.
        let view = ScreenView::new();
        let mut screen = screen("/?x=old");
        view.refresh(&screen);
        apply_screen(
            &mut screen,
            &view,
            ScreenOp::SetParam {
                name: "x".into(),
                value: Some("new".into()),
                push: None,
            },
        );
        let params = read(&view, "params");
        assert!(
            read_key(&params, "x").strict_eq(&Value::from("new")),
            "the next read must see the write: {params:?}"
        );
    }

    #[test]
    fn a_shell_write_is_visible_to_the_next_read() {
        // `screen.shell` is interned by content: a first read must not
        // freeze it — a dialog open, a lane fold and a panel open are the
        // very next read's answers.
        let view = ScreenView::new();
        let mut screen = screen("/");
        view.refresh(&screen);
        let member = |key| read_key(&read(&view, "shell"), key);
        assert!(member("createSpaceOpen").strict_eq(&Value::Bool(false)));
        apply_screen(
            &mut screen,
            &view,
            ScreenOp::SetDialog {
                name: "create_space".into(),
                open: true,
            },
        );
        assert!(
            member("createSpaceOpen").strict_eq(&Value::Bool(true)),
            "the dialog must read open on the very next read"
        );
        apply_screen(
            &mut screen,
            &view,
            ScreenOp::SetLaneCollapsed {
                lane: "tree".into(),
                collapsed: true,
            },
        );
        let lanes = member("collapsedLanes");
        assert!(
            matches!(&lanes, Value::List(l) if l.iter().any(|v| v.strict_eq(&Value::from("tree")))),
            "the folded lane must read back: {lanes:?}"
        );
        apply_screen(
            &mut screen,
            &view,
            ScreenOp::OpenTemplatePanel {
                id: "inspector".into(),
            },
        );
        assert!(
            read_key(&member("panels"), "inspector").strict_eq(&Value::Bool(true)),
            "the opened panel must read open on the very next read"
        );
    }

    #[test]
    fn a_theme_write_is_visible_to_the_next_read() {
        // `screen.theme` interned by content: a first read (the unset
        // theme's `Undefined`) must not freeze `currentThemeId` forever.
        let view = ScreenView::new();
        let mut screen = screen("/");
        view.refresh(&screen);
        let current = || read_key(&read(&view, "theme"), "currentThemeId");
        assert!(
            current().is_undefined(),
            "an unset theme defers to the store"
        );
        apply_screen(
            &mut screen,
            &view,
            ScreenOp::SetCurrentTheme {
                theme: "one".into(),
            },
        );
        assert!(
            current().strict_eq(&Value::from("one")),
            "the next read must see the theme just set"
        );
        apply_screen(
            &mut screen,
            &view,
            ScreenOp::SetCurrentTheme {
                theme: "two".into(),
            },
        );
        assert!(
            current().strict_eq(&Value::from("two")),
            "and the one after that"
        );
    }

    #[test]
    fn an_unchanged_shell_keeps_its_allocation() {
        // The other half of the intern contract: while shell's content
        // holds, the SAME ShellBag allocation answers — a tracked read
        // must not observe a move on an unrelated screen change.
        let view = ScreenView::new();
        let mut screen = screen("/?x=1");
        view.refresh(&screen);
        let s0 = read(&view, "shell");
        apply_screen(
            &mut screen,
            &view,
            ScreenOp::SetParam {
                name: "x".into(),
                value: Some("2".into()),
                push: None,
            },
        );
        let s1 = read(&view, "shell");
        assert!(
            s0.strict_eq(&s1),
            "an unrelated screen change must not move the shell identity"
        );
        apply_screen(
            &mut screen,
            &view,
            ScreenOp::SetDialog {
                name: "create_space".into(),
                open: true,
            },
        );
        let s2 = read(&view, "shell");
        assert!(
            !s0.strict_eq(&s2),
            "a real shell change must move the shell identity"
        );
    }

    #[test]
    fn a_noop_write_leaves_the_snapshot() {
        let view = ScreenView::new();
        let mut screen = screen("/?x=old");
        view.refresh(&screen);
        let before = view.version();
        let changed = apply_screen(
            &mut screen,
            &view,
            ScreenOp::SetParam {
                name: "x".into(),
                value: Some("old".into()),
                push: None,
            },
        );
        assert_eq!(changed, Changed::No);
        assert_eq!(view.version(), before, "a noop never re-snapshots");
    }

    #[test]
    fn member_identity_holds_while_content_does() {
        // R6-1: an unrelated change swaps the snapshot, but `params` keeps
        // its canonical allocation while its content is equal — a tracked
        // read of it must not observe a move.
        let view = ScreenView::new();
        let mut screen = screen("/?id=demo");
        view.refresh(&screen);
        let p0 = read(&view, "params");
        apply_screen(
            &mut screen,
            &view,
            ScreenOp::SetSurface {
                id: "elsewhere".into(),
                width: 100.0,
                tier: "md".into(),
            },
        );
        let p1 = read(&view, "params");
        assert!(
            p0.strict_eq(&p1),
            "an unrelated screen change must not move the params identity"
        );
        apply_screen(
            &mut screen,
            &view,
            ScreenOp::SetParam {
                name: "id".into(),
                value: Some("other".into()),
                push: None,
            },
        );
        let p2 = read(&view, "params");
        assert!(
            !p0.strict_eq(&p2),
            "a real param change must move the params identity"
        );
    }
}
