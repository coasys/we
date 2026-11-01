//! Which window may call which command, and where each window may go.
//!
//! Two layers say the same thing, so a mistake in one fails closed: the capabilities in
//! `capabilities/*.json` grant commands by window label, and every handler checks its caller's
//! label here as well. `tests/commands.rs` reads the capability files and the app manifest in
//! `build.rs` and checks them against [`COMMANDS`].

/// The window labels.
pub const MAIN: &str = "main";
pub const IDENTITY: &str = "identity";

/// Every custody command, and the one window that may call it.
pub const COMMANDS: &[(&str, &str)] = &[
    // The chrome may open the identity window and read public custody state — nothing else.
    ("identity_open", MAIN),
    ("identity_public_state", MAIN),
    // Only the identity window runs a flow.
    ("identity_flow_start", IDENTITY),
    ("identity_flow_step", IDENTITY),
    ("identity_flow_cancel", IDENTITY),
    ("identity_flow_finish", IDENTITY),
];

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("{command} is not callable from the window `{label}`")]
pub struct WrongWindow {
    pub command: String,
    pub label: String,
}

/// Refuses `command` unless `label` is the window it belongs to. Unknown commands are refused.
pub fn require(command: &str, label: &str) -> Result<(), WrongWindow> {
    match COMMANDS.iter().find(|(name, _)| *name == command) {
        Some((_, window)) if *window == label => Ok(()),
        _ => Err(WrongWindow {
            command: command.into(),
            label: label.into(),
        }),
    }
}

/// Where `tauri dev` serves both bundles from: `build.devUrl` in `tauri.conf.json`.
pub const DEV_HOST: &str = "localhost:1420";

/// Whether the identity window may navigate to `url`: its own bundle only.
///
/// `dev_served` says the app is served from the Vite dev server (`tauri::is_dev()`: true under
/// `tauri dev`, whichever cargo profile it runs — `pnpm tauri:dev` runs `--release` — and false in
/// a packaged build, which serves its bundle over its own protocol). Only then is the dev origin
/// the bundle's; a packaged build refuses every `http://localhost` page.
pub fn identity_may_navigate(url: &str, dev_served: bool) -> bool {
    let Some((scheme, rest)) = url.split_once("://") else {
        return false;
    };
    let (host, path) = rest
        .split_once('/')
        .map(|(h, p)| (h, format!("/{p}")))
        .unwrap_or((rest, "/".into()));
    own_origin(scheme, host, dev_served) && path.starts_with("/identity/") && !path.contains("..")
}

/// Whether `scheme://host` is where the app's own bundles are served from.
fn own_origin(scheme: &str, host: &str, dev_served: bool) -> bool {
    matches!(
        (scheme, host),
        ("tauri", "localhost") | ("http", "tauri.localhost") | ("https", "tauri.localhost")
    ) || (dev_served && scheme == "http" && host == DEV_HOST)
}

/// The sources that `directive` names in the policy `policy`, in order. Empty when the policy does
/// not have the directive. When a directive occurs two times, the first one counts, as in a browser.
pub fn csp_sources(policy: &str, directive: &str) -> Vec<String> {
    policy
        .split(';')
        .map(|part| part.split_whitespace())
        .find_map(|mut words| {
            words
                .next()
                .filter(|name| name.eq_ignore_ascii_case(directive))
                .map(|_| words.map(str::to_string).collect())
        })
        .unwrap_or_default()
}

/// Whether the main window may navigate to `url`.
///
/// The main window stays on the app's own pages (not the identity bundle, which is the identity
/// window's). On Linux and macOS the webview also asks this for each frame, and cannot say which
/// frame asks, so an address that the policy's `frame-src` (`frame_sources`) lets a frame load is
/// permitted too, as is the empty page a frame starts on. On Windows the webview asks for the
/// top-level page only, and the app passes no `frame_sources`. A `blob:` address of the app's own
/// origin is permitted: the app saves a file by a click on a link to one (`saveFile.ts` in
/// `@we/design-utils`), and only the app's own code can make one. All other addresses are refused:
/// a link to another site opens in the browser only when it asks for a new window (see
/// [`opens_in_browser`]).
pub fn main_may_navigate(url: &str, frame_sources: &[String], dev_served: bool) -> bool {
    if url == "about:blank" || url == "about:srcdoc" {
        return true;
    }
    if let Some(inner) = url.strip_prefix("blob:") {
        return Address::parse(inner)
            .is_some_and(|parts| own_origin(parts.scheme, parts.authority, dev_served));
    }
    let Some(parts) = Address::parse(url) else {
        return false;
    };
    if own_origin(parts.scheme, parts.authority, dev_served) {
        return !parts.path.starts_with("/identity/");
    }
    frame_sources.iter().any(|source| parts.matches(source))
}

/// Whether a request for a new window opens `url` in the OS browser: an `https` address with a host
/// and no credentials. The main window itself never opens a new window.
pub fn opens_in_browser(url: &str) -> bool {
    Address::parse(url).is_some_and(|a| a.scheme == "https" && !a.host.is_empty())
}

/// The parts of a hierarchical address that the window rules look at.
struct Address<'a> {
    scheme: &'a str,
    /// `host` or `host:port`.
    authority: &'a str,
    host: &'a str,
    port: Option<&'a str>,
    path: &'a str,
}

impl<'a> Address<'a> {
    /// `scheme://authority/path`, or `None` for an address of another form, or one with
    /// credentials (`user@host`), which the rules always refuse.
    fn parse(url: &'a str) -> Option<Self> {
        let (scheme, rest) = url.split_once("://")?;
        let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
        let (authority, path) = rest.split_at(end);
        if authority.contains('@') {
            return None;
        }
        let (host, port) = match authority.rsplit_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        };
        Some(Address {
            scheme,
            authority,
            host,
            port,
            path: if path.is_empty() { "/" } else { path },
        })
    }

    /// Whether this address matches one CSP source: a scheme (`https:`) or
    /// `scheme://host[:port][/path]`, the host with an optional leading `*.` and the port
    /// optionally `*`. Keywords (`'self'`, `'none'`) and other forms match nothing here.
    fn matches(&self, source: &str) -> bool {
        if let Some(scheme) = source.strip_suffix(':') {
            return !scheme.contains('/') && self.scheme.eq_ignore_ascii_case(scheme);
        }
        let Some(source) = Address::parse(source) else {
            return false;
        };
        if !self.scheme.eq_ignore_ascii_case(source.scheme) || self.host.is_empty() {
            return false;
        }
        let host = self.host.to_ascii_lowercase();
        let wanted = source.host.to_ascii_lowercase();
        let host_ok = match wanted.strip_prefix("*.") {
            Some(parent) => host.ends_with(&format!(".{parent}")),
            None => host == wanted,
        };
        let port_ok = match source.port {
            Some("*") => true,
            wanted => wanted == self.port,
        };
        host_ok && port_ok && self.path.starts_with(source.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_command_answers_its_own_window_only() {
        assert!(require("identity_open", MAIN).is_ok());
        assert!(require("identity_public_state", MAIN).is_ok());
        assert!(require("identity_flow_start", IDENTITY).is_ok());
        // The chrome cannot run a flow, and the identity window cannot open another one.
        for command in [
            "identity_flow_start",
            "identity_flow_step",
            "identity_flow_cancel",
            "identity_flow_finish",
        ] {
            assert!(require(command, MAIN).is_err(), "{command} from main");
        }
        assert!(require("identity_open", IDENTITY).is_err());
        assert!(require("identity_flow_step", "some-other-window").is_err());
        assert!(require("request_credential", IDENTITY).is_err());
    }

    #[test]
    fn the_identity_window_stays_in_its_bundle() {
        // Packaged and dev-served alike: the app's own origin, the identity bundle only.
        for dev in [false, true] {
            assert!(identity_may_navigate(
                "tauri://localhost/identity/index.html",
                dev
            ));
            assert!(identity_may_navigate(
                "http://tauri.localhost/identity/index.html",
                dev
            ));
            assert!(!identity_may_navigate("tauri://localhost/index.html", dev));
            assert!(!identity_may_navigate(
                "https://example.org/identity/index.html",
                dev
            ));
            assert!(!identity_may_navigate(
                "tauri://localhost/identity/../index.html",
                dev
            ));
            assert!(!identity_may_navigate("javascript:alert(1)", dev));
        }
    }

    #[test]
    fn the_dev_server_is_the_bundles_origin_only_when_the_app_is_served_from_it() {
        let dev_page = "http://localhost:1420/identity/index.html";
        // `tauri dev`, in either cargo profile: exactly the dev identity origin.
        assert!(identity_may_navigate(dev_page, true));
        assert!(!identity_may_navigate(
            "http://localhost:1420/index.html",
            true
        ));
        assert!(!identity_may_navigate(
            "http://localhost:1421/identity/index.html",
            true
        ));
        assert!(!identity_may_navigate(
            "https://localhost:1420/identity/index.html",
            true
        ));
        assert!(!identity_may_navigate(
            "http://localhost/identity/index.html",
            true
        ));
        // A packaged build: no localhost page at all.
        assert!(!identity_may_navigate(dev_page, false));
    }

    const FRAMES: &str = "default-src 'self'; frame-src 'self' https://www.youtube.com \
        https://*.vimeo.com http://localhost:*; object-src 'none'";

    fn frames() -> Vec<String> {
        csp_sources(FRAMES, "frame-src")
    }

    #[test]
    fn a_policy_names_its_sources_by_directive() {
        assert_eq!(
            frames(),
            [
                "'self'",
                "https://www.youtube.com",
                "https://*.vimeo.com",
                "http://localhost:*"
            ]
        );
        assert_eq!(csp_sources(FRAMES, "object-src"), ["'none'"]);
        assert!(csp_sources(FRAMES, "img-src").is_empty());
        // Directive names are not case sensitive; a directive given twice counts the first time.
        assert_eq!(
            csp_sources(
                "FRAME-SRC https://a.example; frame-src https://b.example",
                "frame-src"
            ),
            ["https://a.example"]
        );
    }

    #[test]
    fn the_main_window_stays_in_the_app() {
        for dev in [false, true] {
            assert!(main_may_navigate("tauri://localhost/index.html", &[], dev));
            assert!(main_may_navigate("tauri://localhost/", &[], dev));
            assert!(main_may_navigate(
                "http://tauri.localhost/space/x",
                &[],
                dev
            ));
            // The identity bundle is the identity window's.
            assert!(!main_may_navigate(
                "tauri://localhost/identity/index.html",
                &[],
                dev
            ));
            // A page of another site, and every scheme that runs or reads something.
            for url in [
                "https://example.org/",
                "http://example.org/",
                "javascript:alert(1)",
                "file:///etc/passwd",
                "data:text/html,<p>x",
                "mailto:a@example.org",
            ] {
                assert!(!main_may_navigate(url, &frames(), dev), "{url}");
            }
        }
        // The dev server is the app only under `tauri dev`.
        assert!(main_may_navigate(
            "http://localhost:1420/index.html",
            &[],
            true
        ));
        assert!(!main_may_navigate(
            "http://localhost:1420/index.html",
            &[],
            false
        ));
    }

    #[test]
    fn a_file_the_app_saves_through_its_own_blob_address_may_open() {
        let uuid = "0b6c2d34-8e2f-4d55-9a3c-1f0e2a7b9c11";
        for dev in [false, true] {
            assert!(main_may_navigate(
                &format!("blob:tauri://localhost/{uuid}"),
                &[],
                dev
            ));
            assert!(!main_may_navigate(
                &format!("blob:https://example.org/{uuid}"),
                &frames(),
                dev
            ));
            assert!(!main_may_navigate("blob:", &[], dev));
        }
        assert!(main_may_navigate(
            &format!("blob:http://localhost:1420/{uuid}"),
            &[],
            true
        ));
        assert!(!main_may_navigate(
            &format!("blob:http://localhost:1420/{uuid}"),
            &[],
            false
        ));
    }

    #[test]
    fn a_frame_may_load_only_what_the_policy_lets_frames_load() {
        let frames = frames();
        assert!(main_may_navigate("about:blank", &frames, false));
        assert!(main_may_navigate("about:srcdoc", &frames, false));
        assert!(main_may_navigate(
            "https://www.youtube.com/embed/abc",
            &frames,
            false
        ));
        assert!(main_may_navigate(
            "https://player.vimeo.com/video/1",
            &frames,
            false
        ));
        assert!(main_may_navigate(
            "http://localhost:8123/app/",
            &frames,
            false
        ));
        // Not the bare parent of a wildcard, not another scheme, not a host that merely ends alike.
        assert!(!main_may_navigate("https://vimeo.com/1", &frames, false));
        assert!(!main_may_navigate(
            "http://www.youtube.com/embed/abc",
            &frames,
            false
        ));
        assert!(!main_may_navigate(
            "https://evilyoutube.com/",
            &frames,
            false
        ));
        assert!(!main_may_navigate(
            "https://www.youtube.com.evil.example/",
            &frames,
            false
        ));
        // An address with credentials in it is refused whatever its host.
        assert!(!main_may_navigate(
            "https://a@www.youtube.com/embed/abc",
            &frames,
            false
        ));
        // A scheme source allows that scheme; a port must match unless it is `*`.
        assert!(main_may_navigate(
            "https://any.example/",
            &["https:".into()],
            false
        ));
        assert!(!main_may_navigate(
            "http://any.example/",
            &["https:".into()],
            false
        ));
        let one_port = vec!["http://localhost:8000".to_string()];
        assert!(main_may_navigate(
            "http://localhost:8000/",
            &one_port,
            false
        ));
        assert!(!main_may_navigate(
            "http://localhost:8001/",
            &one_port,
            false
        ));
    }

    #[test]
    fn only_an_https_address_opens_in_the_browser() {
        assert!(opens_in_browser("https://example.org/a?b"));
        for url in [
            "http://example.org/",
            "https://",
            "https://user:pw@example.org/",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "mailto:a@example.org",
            "tauri://localhost/index.html",
            "ftp://example.org/",
        ] {
            assert!(!opens_in_browser(url), "{url}");
        }
    }

    #[test]
    fn the_dev_host_is_the_one_tauri_dev_serves_from() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(conf["build"]["devUrl"], format!("http://{DEV_HOST}"));
    }
}
