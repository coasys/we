//! Where a window's page may go.
//!
//! The same decisions as Electron's `navigationPolicy.js` and Tauri's identity rule: a window stays
//! on its own bundle; an http(s) link it is pointed at opens in the person's browser instead; every
//! other scheme is refused. A new window is never opened inside this app.
//!
//! The seed's embedded apps (`apps` in `we-seed.json`, served on localhost ports by the other two
//! shells) would be trusted origins here too; this shell does not serve them yet and WE's seed
//! lists none, so no localhost origin is trusted.

/// What to do with a navigation the page asked for.
#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    /// Refuse it here, and hand the URL to the system browser.
    OpenExternally,
    Refuse,
}

/// The origin of `url` as `scheme://host[:port]`, lower-cased, or `None` when it does not parse.
pub fn origin_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    if scheme.is_empty() || !scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    // Credentials in the authority (`user@host`) are never part of an origin we trust.
    if authority.contains('@') || authority.is_empty() {
        return None;
    }
    Some(format!("{}://{}", scheme.to_ascii_lowercase(), authority.to_ascii_lowercase()))
}

/// The decision for a main-frame navigation to `url` in a window whose bundle is at `own_origin`.
pub fn decide(url: &str, own_origin: &str) -> Decision {
    if url == "about:blank" {
        return Decision::Allow;
    }
    if origin_of(url).as_deref() == Some(own_origin) {
        return Decision::Allow;
    }
    if url.starts_with("https://") || url.starts_with("http://") {
        return Decision::OpenExternally;
    }
    Decision::Refuse
}

/// Whether a URL may be handed to the system browser: http(s) only, never `file:` or a handler
/// scheme some other program registered.
pub fn externally_openable(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("http://")) && origin_of(url).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWN: &str = "we://localhost";

    #[test]
    fn the_bundle_itself_is_allowed() {
        assert_eq!(decide("we://localhost/", OWN), Decision::Allow);
        assert_eq!(decide("we://localhost/spaces/x?y#z", OWN), Decision::Allow);
        assert_eq!(decide("WE://LOCALHOST/", OWN), Decision::Allow);
        assert_eq!(decide("about:blank", OWN), Decision::Allow);
    }

    #[test]
    fn the_other_bundle_is_refused() {
        // The identity window's scheme is not the app's, and the other way round.
        assert_eq!(decide("we-identity://localhost/index.html", OWN), Decision::Refuse);
        assert_eq!(
            decide("we://localhost/", "we-identity://localhost"),
            Decision::Refuse
        );
    }

    #[test]
    fn a_lookalike_host_is_not_the_bundle() {
        assert_eq!(decide("we://localhost.evil/", OWN), Decision::Refuse);
        assert_eq!(decide("we://user@localhost/", OWN), Decision::Refuse);
    }

    #[test]
    fn web_links_go_to_the_browser_and_other_schemes_nowhere() {
        assert_eq!(decide("https://example.com/", OWN), Decision::OpenExternally);
        assert_eq!(decide("http://localhost:1234/", OWN), Decision::OpenExternally);
        assert_eq!(decide("file:///etc/passwd", OWN), Decision::Refuse);
        assert_eq!(decide("javascript:alert(1)", OWN), Decision::Refuse);
        assert_eq!(decide("data:text/html,x", OWN), Decision::Refuse);
    }

    #[test]
    fn only_http_urls_open_externally() {
        assert!(externally_openable("https://example.com/a"));
        assert!(!externally_openable("file:///x"));
        assert!(!externally_openable("https://"));
        assert!(!externally_openable("mailto:x@y"));
    }
}
