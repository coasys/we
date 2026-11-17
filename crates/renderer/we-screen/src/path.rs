//! What a path a template writes means — `navigationPaths.ts` and
//! `viewRoutes.ts` ported (rules 1 and 2 of `screen-state.md`).
//!
//! A template is mounted under a prefix it does not choose (`/space/<id>`),
//! so it writes addresses relative: `.`/`..` against the route a node is in,
//! `~/x` against the template's root, `?x` against the page on screen.
//! Absolute paths and URLs are left as written.

/// `SPACE_ROUTE_DEPTH` (`viewRoutes.ts:71`) — how many segments
/// `/space/:spaceId` occupies: the prefix a template inside a space is
/// mounted under, and the floor `..` never climbs below.
pub const SPACE_ROUTE_DEPTH: usize = 2;

/// Where a relative path is resolved from, as numbers of segments of the
/// address on screen (`PathBase`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PathBase {
    /// How many segments the route a node is rendered in spans.
    pub depth: usize,
    /// How many segments the template's root spans.
    pub root: usize,
}

/// `templateRootDepth` (`RouteStore.tsx:115`) — `SPACE_ROUTE_DEPTH` inside a
/// space, `0` outside one.
pub fn template_root_depth(path: &str) -> usize {
    if path.split('/').find(|s| !s.is_empty()) == Some("space") {
        SPACE_ROUTE_DEPTH
    } else {
        0
    }
}

/// Whether a path is resolved by [`resolve_path`] rather than used as written
/// (`isRelativePath`). `/x`, `#x` and `scheme:x` are not relative.
pub fn is_relative_path(to: &str) -> bool {
    let path = to.trim();
    !(path.starts_with('/') || path.starts_with('#') || has_scheme(path))
}

/// `/^[a-z][a-z0-9+.-]*:/i` — a URI scheme, hand-rolled rather than a regex.
fn has_scheme(s: &str) -> bool {
    match s.find(':') {
        Some(0) | None => false,
        Some(i) => {
            let scheme = &s[..i];
            let mut chars = scheme.chars();
            matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
                && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
        }
    }
}

/// The address `to` leads to, from `current` (the address on screen) and the
/// node's `base` (`resolvePath`). Anything absolute is returned unchanged. A
/// base deeper than the address is clamped to it, and a root deeper than the
/// base is the base's floor.
pub fn resolve_path(to: &str, current: &str, base: PathBase) -> String {
    let written = to.trim();
    if !is_relative_path(written) {
        return written.to_string();
    }

    let current_path = current.split(['?', '#']).next().unwrap_or("");
    if written.starts_with('?') {
        return format!(
            "{}{written}",
            if current_path.is_empty() {
                "/"
            } else {
                current_path
            }
        );
    }

    let segments: Vec<&str> = current_path.split('/').filter(|s| !s.is_empty()).collect();
    let root = base.root.min(segments.len());
    let (mut path, suffix) = match written.find(['?', '#']) {
        Some(i) => (&written[..i], &written[i..]),
        None => (written, ""),
    };

    let at;
    if path == "~" || path.starts_with("~/") {
        at = root;
        path = &path[1..];
    } else {
        let mut depth = base.depth.max(root).min(segments.len());
        loop {
            if path == "." || path == "./" {
                path = "";
            } else if let Some(rest) = path.strip_prefix("./") {
                path = rest;
            } else if path == ".." || path.starts_with("../") {
                depth = depth.saturating_sub(1).max(root);
                path = if path == ".." { &path[2..] } else { &path[3..] };
            } else {
                break;
            }
        }
        at = depth;
    }

    // Interior `.` segments are dropped, interior `..` segments are kept as
    // written — the route patterns treat them as plain text.
    let rest = path.split('/').filter(|s| !s.is_empty() && *s != ".");
    format!(
        "/{}{}",
        segments[..at]
            .iter()
            .copied()
            .chain(rest)
            .collect::<Vec<_>>()
            .join("/"),
        suffix
    )
}
