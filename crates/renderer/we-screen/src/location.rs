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
    /// `"/space/abc/dna"` → `["space","abc","dna"]`.
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
        // `..` when the address is written, `..` clamped at the root. The
        // pure `resolve_path` keeps them literal on purpose (paths.json);
        // this is the boundary that resolves them.
        let mut segments: Vec<String> = Vec::new();
        for seg in path.split('/').filter(|s| !s.is_empty()) {
            match seg {
                "." => {}
                ".." => {
                    segments.pop();
                }
                s => segments.push(s.to_string()),
            }
        }
        Location {
            segments,
            params: parse_query(query),
            fragment,
        }
    }

    /// The path only — `/space/abc/board`, or `/` when there are no segments.
    pub fn pathname(&self) -> String {
        if self.segments.is_empty() {
            "/".into()
        } else {
            format!("/{}", self.segments.join("/"))
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
