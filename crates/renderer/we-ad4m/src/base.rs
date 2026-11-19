//! What the desktop host offers the base connect screen.
//!
//! The catalog is this computer, then the servers the person keeps. A
//! click on this computer dials an explicit loopback URL through the
//! existing [`crate::connect::ConnectFlow`], so a remembered URL cannot
//! answer the click. A server cannot be opened from this app yet (the
//! desktop host refuses it the same way): selecting one returns the
//! refusal and dials nothing, so this computer's tokens and its loopback
//! operator access never go to a server.

use std::path::{Path, PathBuf};

use crate::connect::{scrub, ConnectSettings};

/// This computer, as the base template's connection row names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ThisComputer {
    pub id: &'static str,
    pub kind: &'static str,
    pub icon: &'static str,
    pub label: &'static str,
    pub detail: &'static str,
}

/// The only connection slice 1 offers.
pub fn this_computer() -> ThisComputer {
    ThisComputer {
        id: "this-device",
        kind: "this-device",
        icon: "laptop",
        label: "This computer",
        detail: "Available while this computer is on",
    }
}

/// One row of the catalog, as the template's `baseStore.connections`
/// names it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Offer {
    pub id: String,
    pub kind: String,
    pub icon: String,
    pub label: String,
    pub detail: String,
}

impl From<ThisComputer> for Offer {
    fn from(row: ThisComputer) -> Self {
        Self {
            id: row.id.into(),
            kind: row.kind.into(),
            icon: row.icon.into(),
            label: row.label.into(),
            detail: row.detail.into(),
        }
    }
}

/// A server the person keeps in the base file.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SavedServer {
    #[serde(default)]
    pub name: String,
    pub address: String,
}

/// The rows the connect screen lists: this computer first, then each kept
/// server. An `--executor-url` that is not loopback is listed as a server
/// too: it is not this computer, so it does not get that label.
pub fn catalog(settings: &ConnectSettings, servers: &[SavedServer]) -> Vec<Offer> {
    let mut rows: Vec<Offer> = vec![this_computer().into()];
    let mut add = |address: &str, name: &str| {
        let address = address.trim();
        let id = format!("{SERVER_PREFIX}{address}");
        if address.is_empty() || rows.iter().any(|row| row.id == id) {
            return;
        }
        let name = name.trim();
        rows.push(Offer {
            id,
            kind: "server".into(),
            icon: "hard-drives".into(),
            label: if name.is_empty() { address } else { name }.into(),
            detail: address.into(),
        });
    };
    for server in servers {
        add(&server.address, &server.name);
    }
    if let Some(url) = settings.url.as_deref().map(str::trim) {
        if !url.is_empty() && !is_loopback(url) {
            if let Some((host, port)) = authority(url) {
                let address = match port {
                    Some(port) => format!("{host}:{port}"),
                    None => host,
                };
                add(&address, "");
            }
        }
    }
    rows
}

const SERVER_PREFIX: &str = "server:";

/// What the desktop host says when a server is chosen.
pub fn server_refusal(label: &str) -> String {
    format!("Can't open {label} from this app yet. Choose This computer.")
}

/// The endpoint a chosen row is reached at.
///
/// This computer gives settings whose URL is a loopback URL, set
/// explicitly so discovery and a remembered URL cannot replace it. Every
/// other kind is refused with the sentence the connect stage shows.
pub fn select(
    kind: &str,
    label: &str,
    settings: &ConnectSettings,
) -> Result<ConnectSettings, String> {
    if kind != this_computer().kind {
        return Err(server_refusal(label));
    }
    let mut local = settings.clone();
    local.url = Some(explicit_local_url(settings));
    Ok(local)
}

/// Whether `url` names this computer: `127.0.0.0/8`, `localhost` or `::1`.
pub fn is_loopback(url: &str) -> bool {
    match authority(url) {
        Some((host, _)) => {
            host == "localhost"
                || host == "::1"
                || host
                    .parse::<std::net::Ipv4Addr>()
                    .is_ok_and(|ip| ip.is_loopback())
        }
        None => false,
    }
}

/// The lower-case host (no brackets) and the port of an `http`, `https`,
/// `ws` or `wss` URL. `None` for anything else, or for a URL with
/// userinfo: its host is not what a reader sees first.
fn authority(url: &str) -> Option<(String, Option<u16>)> {
    let (scheme, rest) = url.trim().split_once("://")?;
    if !matches!(
        scheme.to_ascii_lowercase().as_str(),
        "http" | "https" | "ws" | "wss"
    ) {
        return None;
    }
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    if authority.contains('@') {
        return None;
    }
    let (host, port) = if let Some(bracketed) = authority.strip_prefix('[') {
        let (host, after) = bracketed.split_once(']')?;
        let port = match after {
            "" => None,
            after => Some(after.strip_prefix(':')?),
        };
        (host, port)
    } else {
        match authority.split_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        }
    };
    let port = port.map(str::parse::<u16>).transpose().ok()?;
    if host.is_empty() {
        return None;
    }
    Some((host.to_ascii_lowercase(), port))
}

/// What the base file keeps: the id chosen last and the servers listed.
/// No address of this computer and no credential.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BaseFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub servers: Vec<SavedServer>,
}

impl BaseFile {
    /// The file at `path`. A missing or unreadable file is an empty one.
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    /// Keep `id` as the connection chosen last. The server list is kept.
    /// The file is replaced whole, through a temporary file beside it.
    pub fn remember(path: &Path, id: &str) -> std::io::Result<()> {
        let mut file = Self::load(path);
        file.connection = Some(id.to_string());
        let dir = path.parent().unwrap_or_else(|| Path::new("."));
        std::fs::create_dir_all(dir)?;
        let text = serde_json::to_string_pretty(&file).map_err(std::io::Error::other)?;
        let mut temp = path.as_os_str().to_owned();
        temp.push(".tmp");
        let temp = PathBuf::from(temp);
        std::fs::write(&temp, text)?;
        std::fs::rename(&temp, path)
    }
}

/// Where the desktop app keeps its base file:
/// `{config}/we-renderer/base.json` (`$XDG_CONFIG_HOME`, else
/// `~/.config`).
pub fn default_base_file() -> PathBuf {
    let mut dir = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .unwrap_or_else(|| {
            let mut home = std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."));
            home.push(".config");
            home
        });
    dir.push("we-renderer");
    dir.push("base.json");
    dir
}

/// How a failed connect attempt is shown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FailureClass {
    /// The executor did not answer. The screen uses its own sentence.
    Unreachable,
    /// Any other failure. `reason` is the sentence the connect stage shows.
    Refused { reason: String },
}

/// Classify a [`crate::connect::ConnectPhase::Failed`] reason.
///
/// The flow's typed error is a string in this build. The match is on the
/// words that string already carries.
pub fn classify_failure(reason: &str) -> FailureClass {
    let lower = reason.to_ascii_lowercase();
    if lower.contains("does not answer")
        || lower.contains("no ad4m executor")
        || lower.contains("connection refused")
        || lower.contains("timed out")
        || lower.contains("os error")
    {
        FailureClass::Unreachable
    } else {
        FailureClass::Refused {
            reason: scrub(reason),
        }
    }
}

/// The URL a click on This computer dials.
///
/// A loopback `--executor-url` wins. One that is not loopback is not this
/// computer: [`catalog`] lists it as a server, and it is ignored here.
/// Otherwise a port file that is a port number or a loopback `http` URL
/// becomes `http://127.0.0.1:{port}`. Anything else, including a
/// non-loopback URL in the port file, is `http://127.0.0.1:12000`. The
/// caller writes the result into [`ConnectSettings::url`] before
/// [`crate::connect::ConnectFlow::start`], so discovery and a remembered
/// URL cannot replace it.
pub fn explicit_local_url(settings: &ConnectSettings) -> String {
    if let Some(url) = settings
        .url
        .as_deref()
        .map(str::trim)
        .filter(|url| is_loopback(url))
    {
        return url.to_string();
    }
    let path = settings.port_file.clone().unwrap_or_else(default_port_file);
    if let Some(port) = read_local_port(&path) {
        return format!("http://127.0.0.1:{port}");
    }
    "http://127.0.0.1:12000".to_string()
}

fn default_port_file() -> PathBuf {
    let mut home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.push(".ad4m");
    home.push("executor-port");
    home
}

fn read_local_port(path: &Path) -> Option<u16> {
    let text = std::fs::read_to_string(path).ok()?;
    let text = text.trim();
    if let Ok(port) = text.parse::<u16>() {
        return (port > 0).then_some(port);
    }
    loopback_port(text)
}

fn loopback_port(text: &str) -> Option<u16> {
    let text = text.trim().trim_end_matches('/');
    let rest = text
        .strip_prefix("http://127.0.0.1:")
        .or_else(|| text.strip_prefix("http://localhost:"))
        .or_else(|| text.strip_prefix("http://[::1]:"))?;
    if rest.contains('/') || rest.contains('?') || rest.contains('#') {
        return None;
    }
    let port: u16 = rest.parse().ok()?;
    (port > 0).then_some(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_explicit_url_wins_over_the_port_file() {
        let dir = tempfile::tempdir().unwrap();
        let port_file = dir.path().join("executor-port");
        std::fs::write(&port_file, "3999").unwrap();
        let settings = ConnectSettings {
            url: Some("http://127.0.0.1:12001".into()),
            port_file: Some(port_file),
            ..ConnectSettings::default()
        };
        assert_eq!(explicit_local_url(&settings), "http://127.0.0.1:12001");
    }

    #[test]
    fn a_port_number_becomes_loopback() {
        let dir = tempfile::tempdir().unwrap();
        let port_file = dir.path().join("executor-port");
        std::fs::write(&port_file, "4123\n").unwrap();
        let settings = ConnectSettings {
            port_file: Some(port_file),
            ..ConnectSettings::default()
        };
        assert_eq!(explicit_local_url(&settings), "http://127.0.0.1:4123");
    }

    #[test]
    fn a_loopback_url_in_the_port_file_keeps_its_port() {
        let dir = tempfile::tempdir().unwrap();
        let port_file = dir.path().join("executor-port");
        std::fs::write(&port_file, "http://localhost:4124/").unwrap();
        let settings = ConnectSettings {
            port_file: Some(port_file),
            ..ConnectSettings::default()
        };
        assert_eq!(explicit_local_url(&settings), "http://127.0.0.1:4124");
    }

    #[test]
    fn a_remote_port_file_does_not_win() {
        let dir = tempfile::tempdir().unwrap();
        let port_file = dir.path().join("executor-port");
        std::fs::write(&port_file, "http://example.test:9").unwrap();
        let settings = ConnectSettings {
            port_file: Some(port_file),
            ..ConnectSettings::default()
        };
        assert_eq!(explicit_local_url(&settings), "http://127.0.0.1:12000");
    }

    #[test]
    fn a_missing_port_file_is_the_default_port() {
        let settings = ConnectSettings {
            port_file: Some(PathBuf::from("/no/such/executor-port")),
            ..ConnectSettings::default()
        };
        assert_eq!(explicit_local_url(&settings), "http://127.0.0.1:12000");
    }

    #[test]
    fn refused_and_unreachable_are_different() {
        assert_eq!(
            classify_failure("connection refused"),
            FailureClass::Unreachable
        );
        assert_eq!(
            classify_failure("The executor at http://127.0.0.1:1 does not answer."),
            FailureClass::Unreachable
        );
        assert_eq!(
            classify_failure("No AD4M executor found."),
            FailureClass::Unreachable
        );
        match classify_failure("the executor refused this app's token — connect again") {
            FailureClass::Refused { reason } => assert!(reason.contains("refused"), "{reason}"),
            FailureClass::Unreachable => panic!("a refusal was classed unreachable"),
        }
    }

    fn isolated(url: Option<&str>) -> (tempfile::TempDir, ConnectSettings) {
        let dir = tempfile::tempdir().unwrap();
        let settings = ConnectSettings {
            url: url.map(str::to_string),
            token_dir: Some(dir.path().join("tokens")),
            port_file: Some(dir.path().join("no-port-file")),
            ..ConnectSettings::default()
        };
        (dir, settings)
    }

    fn saved(name: &str, address: &str) -> SavedServer {
        SavedServer {
            name: name.into(),
            address: address.into(),
        }
    }

    /// Acceptance: a server selection explains the refusal. It dials
    /// nothing, so it cannot use localhost under the server's label.
    #[test]
    fn a_server_selection_explains_the_refusal() {
        let (_dir, settings) = isolated(None);
        let refused = select("server", "Lab box", &settings).expect_err("a server is refused");
        assert_eq!(
            refused,
            "Can't open Lab box from this app yet. Choose This computer."
        );
        for kind in ["key-host", "connect", "", "this-device "] {
            assert!(
                select(kind, "Elsewhere", &settings).is_err(),
                "kind {kind:?} was selected"
            );
        }
    }

    /// Acceptance: selection never sends this computer's credentials to
    /// another host. This computer is always a loopback URL, even when
    /// `--executor-url` names a remote executor.
    #[test]
    fn this_computer_never_dials_a_remote_executor_url() {
        for remote in [
            "https://remote.example",
            "http://192.168.1.20:12000",
            "http://127.0.0.1.example:12000",
            "http://localhost.example:12000",
        ] {
            let (_dir, settings) = isolated(Some(remote));
            let local = select("this-device", "This computer", &settings).unwrap();
            let url = local.url.clone().unwrap();
            assert_eq!(url, "http://127.0.0.1:12000", "{remote} dialed as {url}");
            assert!(is_loopback(&url));
            assert_eq!(local.token_dir, settings.token_dir);
        }
        let (_dir, settings) = isolated(Some("http://localhost:4100"));
        let local = select("this-device", "This computer", &settings).unwrap();
        assert_eq!(local.url.as_deref(), Some("http://localhost:4100"));
    }

    #[test]
    fn loopback_is_only_this_computer() {
        for url in [
            "http://127.0.0.1:12000",
            "http://127.1.2.3:1",
            "http://localhost:4000/",
            "http://LOCALHOST:4000",
            "http://[::1]:12000",
            "ws://127.0.0.1:12000/graphql",
        ] {
            assert!(is_loopback(url), "{url}");
        }
        for url in [
            "https://remote.example",
            "http://127.0.0.1.example:1",
            "http://localhost.example:1",
            "http://user@remote.example:1",
            "http://127.0.0.1@remote.example:1",
            "http://[::2]:1",
            "http://0.0.0.0:12000",
            "file:///tmp/x",
            "127.0.0.1:12000",
            "",
        ] {
            assert!(!is_loopback(url), "{url}");
        }
    }

    #[test]
    fn the_catalog_lists_this_computer_then_servers() {
        let (_dir, settings) = isolated(Some("https://remote.example:9443/path?q=1"));
        let rows = catalog(&settings, &[saved("Lab box", "lab.example:12000")]);
        let ids: Vec<&str> = rows.iter().map(|row| row.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "this-device",
                "server:lab.example:12000",
                "server:remote.example:9443"
            ]
        );
        assert_eq!(rows[0], Offer::from(this_computer()));
        assert_eq!(rows[1].label, "Lab box");
        assert_eq!(rows[1].kind, "server");
        assert_eq!(rows[2].label, "remote.example:9443");
        assert!(rows.iter().all(|row| !row.detail.contains('?')));

        let (_dir, settings) = isolated(Some("http://127.0.0.1:4100"));
        let rows = catalog(&settings, &[saved("", "lab.example:12000")]);
        assert_eq!(rows.len(), 2, "a loopback url is this computer: {rows:?}");
        assert_eq!(rows[1].label, "lab.example:12000");

        let rows = catalog(
            &settings,
            &[saved("", "lab.example:1"), saved("again", "lab.example:1")],
        );
        assert_eq!(rows.len(), 2, "one row per address: {rows:?}");
    }

    #[test]
    fn the_base_file_keeps_the_choice_and_the_servers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("we").join("base.json");
        assert_eq!(BaseFile::load(&path), BaseFile::default());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"servers":[{"name":"Lab box","address":"lab.example:12000"}]}"#,
        )
        .unwrap();
        BaseFile::remember(&path, "this-device").unwrap();
        let file = BaseFile::load(&path);
        assert_eq!(file.connection.as_deref(), Some("this-device"));
        assert_eq!(file.servers, [saved("Lab box", "lab.example:12000")]);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(
            !text.contains("127.0.0.1"),
            "an address of this computer was kept: {text}"
        );

        std::fs::write(&path, "{ not json").unwrap();
        assert_eq!(BaseFile::load(&path), BaseFile::default());

        let fresh = dir.path().join("new").join("base.json");
        BaseFile::remember(&fresh, "server:lab.example:12000").unwrap();
        assert_eq!(
            BaseFile::load(&fresh).connection.as_deref(),
            Some("server:lab.example:12000")
        );
    }

    /// Acceptance: an explicit choice escapes a stale remembered endpoint.
    /// `ad4m-connect` remembers a pinned URL per app and would try it
    /// first. This computer's selection names its URL explicitly, so the
    /// flow never dials the remembered one.
    #[test]
    fn this_computer_does_not_dial_a_stale_remembered_url() {
        use std::net::TcpListener;

        let stale = TcpListener::bind("127.0.0.1:0").unwrap();
        let stale_url = format!("http://127.0.0.1:{}", stale.local_addr().unwrap().port());
        stale.set_nonblocking(true).unwrap();
        let closed = TcpListener::bind("127.0.0.1:0").unwrap();
        let closed_port = closed.local_addr().unwrap().port();
        drop(closed);

        let (dir, mut settings) = isolated(None);
        let port_file = dir.path().join("executor-port");
        std::fs::write(&port_file, closed_port.to_string()).unwrap();
        settings.port_file = Some(port_file);
        let app = crate::connect::app_info(&settings.scope).name;
        ad4m_client::connect::TokenStore::new(settings.token_dir.clone().unwrap())
            .set_last_url(&app, &stale_url, true)
            .unwrap();

        let local = select("this-device", "This computer", &settings).unwrap();
        assert_eq!(
            local.url.as_deref(),
            Some(format!("http://127.0.0.1:{closed_port}").as_str())
        );

        let rt = crate::Runtime::new().unwrap();
        let flow = crate::connect::ConnectFlow::start(&rt.handle(), local, || {});
        let start = std::time::Instant::now();
        let reason = loop {
            if let crate::connect::ConnectPhase::Failed { reason } = flow.phase() {
                break reason;
            }
            assert!(start.elapsed().as_secs() < 30, "the flow did not end");
            std::thread::sleep(std::time::Duration::from_millis(20));
        };
        assert_eq!(
            classify_failure(&reason),
            FailureClass::Unreachable,
            "{reason}"
        );
        let mut accepted = 0;
        while stale.accept().is_ok() {
            accepted += 1;
        }
        assert_eq!(accepted, 0, "the stale remembered URL was dialed");
    }
}
