//! One address — `location.rs` of the design. The canonical form is what the
//! URL holds, so web and desktop agree: path segments, query params in order,
//! and an optional fragment.
use indexmap::IndexMap;

use crate::path::SPACE_ROUTE_DEPTH;
use crate::query::{parse_query, search_string};

/// One address. The canonical form is what the URL holds, so web and desktop
/// agree.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Location {
    /// `url.pathname` verbatim — dot segments resolved, interior empty
    /// segments and a trailing slash kept (`routeStore.currentPath`). Page
    /// identity reads this, so `/a/b/` and `/a/b` are different pages.
    pub pathname: String,
    /// `"/space/abc/dna"` → `["space","abc","dna"]` — the nonempty pathname
    /// segments (`currentPath.split('/').filter(Boolean)`), the list a
    /// route reads.
    pub segments: Vec<String>,
    /// The query parameters, insertion order kept so the URL round-trips.
    pub params: IndexMap<String, String>,
    /// The `#fragment`, verbatim (no leading `#`, no decoding).
    pub fragment: Option<String>,
}

/// The typed reading of a [`Location`]. Derived, never stored.
#[derive(Clone, Debug, PartialEq)]
pub enum Route {
    /// `"/"`.
    Landing,
    /// A bundle `pages[]` entry, e.g. `about`.
    Page { id: String },
    /// A space — `section` is `templateSegments`.
    Space {
        space_id: String,
        section: Vec<String>,
    },
    /// Anything else.
    Other,
}

impl Location {
    /// Parse `pathname + search + hash` — the shape `href()` writes, and the
    /// shape a `popstate` report or a `--route` flag carries.
    pub fn parse(href: &str) -> Location {
        // An empty fragment reports no hash at all — `url.hash` reads ''.
        let (before_hash, fragment) = match href.split_once('#') {
            Some((rest, "")) => (rest, None),
            Some((rest, frag)) => (rest, Some(frag.to_string())),
            None => (href, None),
        };
        let (path, query) = match before_hash.split_once('?') {
            Some((p, q)) => (p, q),
            None => (before_hash, ""),
        };
        // A parsed URL never holds dot segments — `new URL` resolves `.` and
        // `..` (percent-encoded spellings included) when the address is
        // written; the pathname keeps every other segment as written,
        // empties and a trailing slash included.
        let pathname = normalize_path(path);
        // Route segments read without the empties —
        // `split('/').filter(Boolean)`, exactly as `routeStore.segments`
        // derives them.
        let segments = pathname
            .split('/')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();
        Location {
            pathname,
            segments,
            params: parse_query(query),
            fragment,
        }
    }

    /// The path only — `/space/abc/board`, or `/` when there are no segments.
    /// The canonical spelling: interior empty segments and a trailing slash
    /// are kept, like `url.pathname`.
    pub fn pathname(&self) -> String {
        if self.pathname.is_empty() {
            "/".into()
        } else {
            self.pathname.clone()
        }
    }

    /// `?name=value&…`, or empty.
    pub fn search(&self) -> String {
        search_string(&self.params)
    }

    /// `pathname + search + hash` — the canonical address.
    pub fn href(&self) -> String {
        let mut out = format!("{}{}", self.pathname(), self.search());
        if let Some(f) = &self.fragment {
            out.push('#');
            out.push_str(f);
        }
        out
    }

    /// `routeStore.templateSegments` — the segments below the space prefix, or
    /// the whole path outside a space (`RouteStore.tsx:184`).
    pub fn template_segments(&self) -> &[String] {
        if self.segments.first().map(String::as_str) == Some("space") {
            self.segments.get(SPACE_ROUTE_DEPTH..).unwrap_or(&[])
        } else {
            &self.segments
        }
    }

    /// The typed reading — `pages` are the bundle's declared page segments.
    pub fn route(&self, pages: &[String]) -> Route {
        match self.segments.first().map(String::as_str) {
            None => Route::Landing,
            Some("space") => Route::Space {
                space_id: self.segments.get(1).cloned().unwrap_or_default(),
                section: self.template_segments().to_vec(),
            },
            Some(s) if self.segments.len() == 1 && pages.iter().any(|p| p == s) => {
                Route::Page { id: s.to_string() }
            }
            _ => Route::Other,
        }
    }
}

/// The pathname a URL parser would hold (WHATWG path-state shortening):
/// `.`/`..` — percent-encoded spellings too — resolve against the whole
/// segment list, empties included (`/a//../b` → `/a/b`, the `..` takes the
/// empty segment), `..` clamped at the root; a `.` or `..` at the end still
/// leaves the slash. Every other segment — empties, trailing slash —
/// survives verbatim. The pure `resolve_path` keeps dots literal on
/// purpose (paths.json); this is the boundary that resolves them.
fn normalize_path(path: &str) -> String {
    let mut resolved: Vec<&str> = Vec::new();
    let mut parts = path.split('/').peekable();
    while let Some(seg) = parts.next() {
        if is_double_dot(seg) {
            resolved.pop();
            if parts.peek().is_none() {
                resolved.push("");
            }
        } else if is_single_dot(seg) {
            if parts.peek().is_none() {
                resolved.push("");
            }
        } else {
            resolved.push(seg);
        }
    }
    let joined = resolved.join("/");
    // A pathname leads with `/` — a path text without one (a scheme-absolute
    // `to` has no origin model; see the notes' gaps) keeps its spelling
    // under one rather than growing a phantom segment.
    if joined.is_empty() {
        "/".to_string()
    } else if joined.starts_with('/') {
        joined
    } else {
        format!("/{joined}")
    }
}

/// `.` or its percent-encoded spelling — WHATWG's "single-dot path
/// segment" (`%2e`, hex case-insensitive).
fn is_single_dot(seg: &str) -> bool {
    seg == "." || seg.eq_ignore_ascii_case("%2e")
}

/// `..` or one of its percent-encoded spellings — WHATWG's "double-dot
/// path segment" (`.%2e`, `%2e.`, `%2e%2e`, hex case-insensitive). A
/// `%2e%2e%2e` is `...`, not a dot segment, and stays literal.
fn is_double_dot(seg: &str) -> bool {
    seg == ".."
        || seg.eq_ignore_ascii_case(".%2e")
        || seg.eq_ignore_ascii_case("%2e.")
        || seg.eq_ignore_ascii_case("%2e%2e")
}
