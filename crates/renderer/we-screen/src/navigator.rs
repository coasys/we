//! `Navigator` — tiers 1 and 2 of the screen state: the address on screen,
//! its params, and the back stack behind it (rules 3, 4, 5, 7 and 9 of
//! `screen-state.md`; `RouteStore.tsx` is the reference implementation).
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use we_expr::Value;

use crate::history::HistoryBackend;
use crate::location::{Location, Route};
use crate::path::{resolve_path, template_root_depth, PathBase};
use crate::query::{encode_pair, query_string};
use crate::schema::{ParamValue, ScreenSchema};

/// Whether a call changed anything — `ScreenState::apply` bumps `version`
/// only on `Yes`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Changed {
    /// Nothing moved: a no-op navigate, a `back()` at the start, a write that
    /// rewrote the same address.
    No,
    /// Something moved.
    Yes,
}

impl Changed {
    /// `self == Yes`.
    pub fn changed(self) -> bool {
        self == Changed::Yes
    }
}

/// What `navigate` takes beside the path (`NavigateOptions`).
#[derive(Clone, Debug, Default)]
pub struct NavigateOptions {
    /// The page's query values, written for it — a record id goes here, never
    /// pasted into `to` (`RouteStore.tsx:65-71`).
    pub query: Option<IndexMap<String, Value>>,
    /// The route a relative path is from, as its depth in segments. Absent,
    /// the template root's depth is the base (`RouteStore.tsx:121`).
    pub base_depth: Option<usize>,
    /// `replace: true` swaps the current entry rather than pushing.
    pub replace: bool,
}

/// Tiers 1 and 2 of the screen state: the location, its params, the back
/// stack and the remembered queries.
pub struct Navigator {
    location: Location,
    /// path → `?query`, memory only — the last query seen on each address,
    /// restored by `navigate` when the target is a bare path (rule 4).
    remembered: HashMap<String, String>,
    schema: ScreenSchema,
    history: Box<dyn HistoryBackend>,
    /// Params whose declared type already rejected a value — the warning is
    /// logged once per name, not once per read.
    warned: RefCell<HashSet<String>>,
}

impl Navigator {
    /// A navigator at the backend's current address — the mount-time location
    /// report included, so a query the session started with is already
    /// remembered (rule 4).
    pub fn new(schema: ScreenSchema, history: Box<dyn HistoryBackend>) -> Navigator {
        let mut nav = Navigator {
            location: Location::parse(&history.current_href()),
            remembered: HashMap::new(),
            schema,
            history,
            warned: RefCell::new(HashSet::new()),
        };
        nav.report();
        nav
    }

    /// Go to `to` (rule 3): resolve the path, append `options.query`, do
    /// nothing when the result equals the current path, restore the
    /// remembered query when the target is a bare path. Pushes a history
    /// entry unless `options.replace`.
    pub fn navigate(&mut self, to: &str, opts: NavigateOptions) -> Changed {
        let here = self.current_path();
        let root = template_root_depth(&here);
        let resolved = resolve_path(
            to,
            &here,
            PathBase {
                depth: opts.base_depth.unwrap_or(root),
                root,
            },
        );
        let written = opts.query.as_ref().map(query_string).unwrap_or_default();
        let path = if written.is_empty() {
            resolved
        } else {
            format!(
                "{}{}{}",
                resolved,
                if resolved.contains('?') { '&' } else { '?' },
                written
            )
        };

        // Already on the exact target: no entry, no move (`RouteStore.tsx:245`).
        if here == path {
            return Changed::No;
        }

        // A bare path restores that route's remembered query; an explicit one
        // — in `to` or in `query` — always wins.
        let target = if !path.contains('?') {
            self.remembered
                .get(&path)
                .map(|s| format!("{path}{s}"))
                .unwrap_or(path)
        } else {
            path
        };
        // A bare `#fragment` stays on this page — the router resolves it
        // against the current address, so the query stays too (`new URL`
        // moves only the hash, `recordNavigation.ts:150`).
        let landed = if let Some(frag) = target.strip_prefix('#') {
            format!("{}{}#{frag}", self.current_path(), self.location.search())
        } else {
            target
        };

        let location = Location::parse(&landed);
        let changed = !opts.replace || location != self.location;
        if opts.replace {
            self.history.replace(&landed);
        } else {
            self.history.push(&landed);
        }
        self.location = location;
        self.report();
        if changed {
            Changed::Yes
        } else {
            Changed::No
        }
    }

    /// Write one query parameter (rule 5): built from the in-app params, not
    /// the address bar. `null` or `''` deletes. Default replace; `push` adds
    /// a Back entry.
    pub fn set_param(&mut self, name: &str, value: Option<&str>, push: bool) -> Changed {
        let mut params = self.location.params.clone();
        match value {
            None | Some("") => {
                params.shift_remove(name);
            }
            Some(v) => {
                params.insert(name.to_string(), v.to_string());
            }
        }
        // `queryString` drops empty values out of the whole map.
        params.retain(|_, v| !v.is_empty());
        let mut location = self.location.clone();
        location.params = params;
        let href = location.href();
        let before = self.location.href();
        // Written through history directly, not the router: the path is
        // unchanged, so the route tree must not re-resolve.
        if push {
            self.history.push(&href);
        } else {
            self.history.replace(&href);
        }
        self.location = location;
        self.report();
        if push || href != before {
            Changed::Yes
        } else {
            Changed::No
        }
    }

    /// `history.back()` (rule 9); at the start of history nothing happens.
    pub fn back(&mut self) -> Changed {
        self.traverse(|h| h.back())
    }

    /// `history.forward()`; at the end of history nothing happens.
    pub fn forward(&mut self) -> Changed {
        self.traverse(|h| h.forward())
    }

    /// A deep link, a first load, a `popstate`: land on `href`, replacing the
    /// current entry — the same report the router would make.
    pub fn open(&mut self, href: &str) -> Changed {
        let location = Location::parse(href);
        let changed = location != self.location;
        self.history.replace(href);
        self.location = location;
        self.report();
        if changed {
            Changed::Yes
        } else {
            Changed::No
        }
    }

    /// The address `to` leads to, resolved as `navigate` would resolve it,
    /// without going there (`routeStore.resolve`). A caller that knows
    /// nothing passes `self.template_base()`.
    pub fn resolve(&self, to: &str, base: PathBase) -> String {
        resolve_path(to, &self.current_path(), base)
    }

    /// `PathBase` for a node at the template root — what `navigate` uses
    /// when `NavigateOptions.base_depth` is absent.
    pub fn template_base(&self) -> PathBase {
        let root = template_root_depth(&self.current_path());
        PathBase { depth: root, root }
    }

    /// The current location.
    pub fn location(&self) -> &Location {
        &self.location
    }

    /// The typed reading of the location (the schema's `pages` decide
    /// `Route::Page`).
    pub fn route(&self) -> Route {
        self.location.route(&self.schema.pages)
    }

    /// `routeStore.page()` (rule 7): path plus the identity param only —
    /// `id` unless the schema moves identity elsewhere.
    pub fn page_identity(&self) -> String {
        let name = self.schema.identity_param();
        match self.location.params.get(name).filter(|v| !v.is_empty()) {
            Some(v) => format!("{}?{}", self.current_path(), encode_pair(name, v)),
            None => self.current_path(),
        }
    }

    /// `pathname + search + hash` — what the web build puts in the URL bar.
    pub fn href(&self) -> String {
        self.location.href()
    }

    /// The path only — `routeStore.currentPath`.
    pub fn current_path(&self) -> String {
        self.location.pathname()
    }

    /// All path segments — `routeStore.segments`.
    pub fn segments(&self) -> &[String] {
        &self.location.segments
    }

    /// The segments below the space prefix — `routeStore.templateSegments`.
    pub fn template_segments(&self) -> &[String] {
        self.location.template_segments()
    }

    /// The URL's query params — `routeStore.params`.
    pub fn params(&self) -> &IndexMap<String, String> {
        &self.location.params
    }

    /// One param, as the string the URL carries — what the template reads.
    pub fn param(&self, name: &str) -> Option<&str> {
        self.location.params.get(name).map(String::as_str)
    }

    /// One param through its declared type — for Rust callers (the template
    /// reads strings). Undeclared params read as strings; a declared param
    /// whose value fails its type reads as absent, and the rejection is
    /// logged once per name (screen-state.md §4.3).
    pub fn param_typed(&self, name: &str) -> Option<ParamValue> {
        let raw = self.location.params.get(name)?;
        match self.schema.param(name) {
            None => Some(ParamValue::Str(raw.clone())),
            Some(decl) => match decl.parse(raw) {
                Some(v) => Some(v),
                None => {
                    if self.warned.borrow_mut().insert(name.to_string()) {
                        log::warn!(
                            "we-screen: param {name:?} value {raw:?} fails its declared type; reading as absent"
                        );
                    }
                    None
                }
            },
        }
    }

    /// The declared `push` default for `set_param` when the caller passes no
    /// explicit answer.
    pub fn declared_push(&self, name: &str) -> bool {
        self.schema.declared_push(name)
    }

    /// The screen's declared params.
    pub fn schema(&self) -> &ScreenSchema {
        &self.schema
    }

    /// Entries in the back stack.
    pub fn depth(&self) -> usize {
        self.history.depth()
    }

    /// The current position in it, 0-based.
    pub fn index(&self) -> usize {
        self.history.index()
    }

    fn traverse(&mut self, go: impl FnOnce(&mut dyn HistoryBackend) -> Option<String>) -> Changed {
        match go(self.history.as_mut()) {
            Some(href) => {
                self.location = Location::parse(&href);
                self.report();
                Changed::Yes
            }
            None => Changed::No,
        }
    }

    /// Rule 4: the last query seen on each address, refreshed on every
    /// location report — navigate, open, traversal and `set_param` alike.
    fn report(&mut self) {
        let search = self.location.search();
        if search.is_empty() {
            self.remembered.remove(&self.location.pathname());
        } else {
            self.remembered.insert(self.location.pathname(), search);
        }
    }
}
