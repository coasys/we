//! Which window may call which command.
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
    let own_origin = matches!(
        (scheme, host),
        ("tauri", "localhost") | ("http", "tauri.localhost") | ("https", "tauri.localhost")
    ) || (dev_served && scheme == "http" && host == DEV_HOST);
    own_origin && path.starts_with("/identity/") && !path.contains("..")
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

    #[test]
    fn the_dev_host_is_the_one_tauri_dev_serves_from() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(conf["build"]["devUrl"], format!("http://{DEV_HOST}"));
    }
}
