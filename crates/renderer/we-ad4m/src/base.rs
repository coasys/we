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

use url::{Host, Url};

use crate::connect::ConnectSettings;

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
    if let Some(url) = settings.url.as_deref().and_then(parse) {
        if !names_this_computer(&url) {
            add(&server_address(&url), "");
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

/// Whether `url` names this computer: an `http`, `https`, `ws` or `wss`
/// URL without userinfo whose host is `localhost` (any case, a terminal
/// dot allowed), in `127.0.0.0/8`, or the IPv6 loopback address in any
/// spelling. The IPv4-mapped `::ffff:127.0.0.1` and the wildcards `0.0.0.0`
/// and `::` are not.
pub fn is_loopback(url: &str) -> bool {
    parse(url).is_some_and(|url| names_this_computer(&url))
}

/// `url` parsed as an `http`, `https`, `ws` or `wss` URL with a host.
/// `None` for anything else, including a bracketed host that is not an
/// IPv6 address (`[localhost]`).
fn parse(url: &str) -> Option<Url> {
    let url = Url::parse(url.trim()).ok()?;
    let web = matches!(url.scheme(), "http" | "https" | "ws" | "wss");
    (web && url.host().is_some()).then_some(url)
}

/// A URL with userinfo is never this computer: its host is not what a
/// reader sees first.
fn names_this_computer(url: &Url) -> bool {
    let userinfo = !url.username().is_empty() || url.password().is_some();
    !userinfo && url.host().is_some_and(|host| loopback_host(&host))
}

fn loopback_host(host: &Host<&str>) -> bool {
    match host {
        Host::Domain(name) => name.strip_suffix('.').unwrap_or(name) == "localhost",
        Host::Ipv4(ip) => ip.is_loopback(),
        Host::Ipv6(ip) => ip.is_loopback(),
    }
}

/// `host:port` (IPv6 in brackets), as a server row names it. Never the
/// userinfo, the path, the query or the fragment.
fn server_address(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default();
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    }
}

/// A loopback URL with its host spelled the way `ad4m-client` accepts:
/// `localhost` without a terminal dot, IPv6 compressed (`[::1]`).
fn canonical_local(url: &Url) -> String {
    let mut url = url.clone();
    if matches!(url.host(), Some(Host::Domain(_))) {
        let _ = url.set_host(Some("localhost"));
    }
    let text = url.to_string();
    match text.strip_suffix('/') {
        Some(bare) if url.path() == "/" && url.query().is_none() && url.fragment().is_none() => {
            bare.to_string()
        }
        _ => text,
    }
}

/// What the base file keeps: the id chosen last and the servers listed.
/// No address of this computer and no credential.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BaseFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub servers: Vec<SavedServer>,
    /// "Skip for now" was chosen on the first run.
    #[serde(
        default,
        rename = "skippedIdentity",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub skipped_identity: bool,
}

impl BaseFile {
    /// Keep "Skip for now". The id chosen and the server list are kept.
    pub fn skip_identity(path: &Path) -> std::io::Result<()> {
        let _ = path;
        Ok(())
    }

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
        // Each write gets its own temporary file, created new, so two app
        // instances that write at the same time never share one.
        static WRITES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let mut temp = path.as_os_str().to_owned();
        temp.push(format!(
            ".{}.{}.tmp",
            std::process::id(),
            WRITES.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let temp = PathBuf::from(temp);
        let written = (|| {
            use std::io::Write;
            let mut out = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)?;
            out.write_all(text.as_bytes())?;
            out.sync_all()?;
            std::fs::rename(&temp, path)?;
            // The rename is durable once the directory is: best effort.
            #[cfg(unix)]
            if let Ok(dir) = std::fs::File::open(dir) {
                let _ = dir.sync_all();
            }
            Ok(())
        })();
        if written.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        written
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

/// The URL a click on This computer dials.
///
/// A loopback `--executor-url` wins, under its canonical host. One that is
/// not loopback, or that carries userinfo, is not this computer:
/// [`catalog`] lists it as a server, and it is ignored here.
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
        .and_then(parse)
        .filter(names_this_computer)
    {
        return canonical_local(&url);
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
            "http://localhost.:4000",
            "http://LocalHost.:4000",
            "http://[::1]:12000",
            "http://[0:0:0:0:0:0:0:1]:4100",
            "http://[0000::1]:4100",
            "ws://127.0.0.1:12000/graphql",
        ] {
            assert!(is_loopback(url), "{url}");
        }
        for url in [
            "https://remote.example",
            "http://127.0.0.1.example:1",
            "http://localhost.example:1",
            "http://localhost.evil.com:1",
            "http://localhost..:1",
            "http://user@remote.example:1",
            "http://127.0.0.1@remote.example:1",
            "http://localhost@remote.example:1",
            "http://user@localhost:1",
            "http://user:pw@127.0.0.1:1",
            "http://[::2]:1",
            "http://[::]:1",
            "http://[::ffff:127.0.0.1]:1",
            "http://0.0.0.0:12000",
            "http://[localhost]:4100",
            "http://[127.0.0.1]:4100",
            "http://localhost:99999",
            "ftp://127.0.0.1:1",
            "file:///tmp/x",
            "127.0.0.1:12000",
            "",
        ] {
            assert!(!is_loopback(url), "{url}");
        }
    }

    /// A loopback `--executor-url` is dialed under its canonical host:
    /// `ad4m-client` treats `localhost.` and an expanded `::1` as remote.
    #[test]
    fn this_computer_dials_a_canonical_loopback_host() {
        for (given, dialed) in [
            ("http://localhost:4100", "http://localhost:4100"),
            ("http://LOCALHOST.:4100/", "http://localhost:4100"),
            ("http://[0:0:0:0:0:0:0:1]:4100", "http://[::1]:4100"),
            (
                "ws://127.0.0.1:12000/graphql",
                "ws://127.0.0.1:12000/graphql",
            ),
        ] {
            let (_dir, settings) = isolated(Some(given));
            let local = select("this-device", "This computer", &settings).unwrap();
            assert_eq!(local.url.as_deref(), Some(dialed), "{given}");
        }
    }

    /// A URL with userinfo is listed, as a server named by host and port
    /// only, and This computer never dials it. A URL that does not parse
    /// (a bracketed name) is not this computer and lists nothing.
    #[test]
    fn a_url_with_userinfo_is_a_server_without_its_credentials() {
        for (url, id) in [
            (
                "https://alice:s3cret@remote.example:9443/path",
                "server:remote.example:9443",
            ),
            (
                "http://alice:s3cret@localhost:4100",
                "server:localhost:4100",
            ),
            (
                "http://localhost@remote.example:1",
                "server:remote.example:1",
            ),
            ("http://alice@[::1]:4100", "server:[::1]:4100"),
        ] {
            let (_dir, settings) = isolated(Some(url));
            let rows = catalog(&settings, &[]);
            assert_eq!(rows.len(), 2, "{url} was not listed: {rows:?}");
            let row = &rows[1];
            assert_eq!(row.id, id, "{url}");
            assert_eq!(row.kind, "server");
            assert_eq!(format!("server:{}", row.label), id);
            for shown in [&row.id, &row.label, &row.detail] {
                assert!(
                    !shown.contains("alice") && !shown.contains("s3cret") && !shown.contains('@'),
                    "{url} shows a credential: {shown}"
                );
            }
            let local = select("this-device", "This computer", &settings).unwrap();
            assert_eq!(
                local.url.as_deref(),
                Some("http://127.0.0.1:12000"),
                "{url}"
            );
        }
        for url in ["http://[localhost]:4100", "http://[127.0.0.1]:4100"] {
            let (_dir, settings) = isolated(Some(url));
            assert_eq!(catalog(&settings, &[]).len(), 1, "{url}");
            let local = select("this-device", "This computer", &settings).unwrap();
            assert_eq!(
                local.url.as_deref(),
                Some("http://127.0.0.1:12000"),
                "{url}"
            );
        }
    }

    /// IPv6 servers keep their brackets, so the port reads apart from the
    /// address; wildcard and mapped addresses are servers, not this computer.
    #[test]
    fn an_ipv6_server_keeps_its_brackets() {
        for (url, id) in [
            ("http://[::2]:4100", "server:[::2]:4100"),
            ("http://[0:0:0:0:0:0:0:2]:4100", "server:[::2]:4100"),
            ("http://[::]:4100", "server:[::]:4100"),
            (
                "http://[::ffff:127.0.0.1]:4100",
                "server:[::ffff:7f00:1]:4100",
            ),
            ("http://0.0.0.0:4100", "server:0.0.0.0:4100"),
        ] {
            let (_dir, settings) = isolated(Some(url));
            let rows = catalog(&settings, &[]);
            assert_eq!(
                rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
                ["this-device", id],
                "{url}"
            );
        }
        for url in ["http://[0:0:0:0:0:0:0:1]:4100", "http://localhost.:4100"] {
            let (_dir, settings) = isolated(Some(url));
            assert_eq!(catalog(&settings, &[]).len(), 1, "{url} is this computer");
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

    /// Each write uses its own temporary file: a stale fixed-name temp file
    /// does not block a write, and writers at the same time leave one whole
    /// file and no temporary files.
    #[test]
    fn base_file_writes_do_not_share_a_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("base.json");
        std::fs::create_dir(dir.path().join("base.json.tmp")).unwrap();
        BaseFile::remember(&path, "this-device").unwrap();

        std::thread::scope(|scope| {
            for writer in 0..8 {
                let path = &path;
                scope.spawn(move || {
                    for round in 0..20 {
                        BaseFile::remember(path, &format!("server:w{writer}-{round}:1")).unwrap();
                    }
                });
            }
        });
        let text = std::fs::read_to_string(&path).unwrap();
        let file: BaseFile = serde_json::from_str(&text).unwrap();
        assert!(file.connection.unwrap().starts_with("server:w"));
        let left: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .filter(|name| name != "base.json" && name != "base.json.tmp")
            .collect();
        assert!(left.is_empty(), "temporary files left: {left:?}");
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
        let (kind, reason) = loop {
            if let crate::connect::ConnectPhase::Failed { kind, reason } = flow.phase() {
                break (kind, reason);
            }
            assert!(start.elapsed().as_secs() < 30, "the flow did not end");
            std::thread::sleep(std::time::Duration::from_millis(20));
        };
        assert_eq!(kind, crate::connect::FailureKind::Unreachable, "{reason}");
        let mut accepted = 0;
        while stale.accept().is_ok() {
            accepted += 1;
        }
        assert_eq!(accepted, 0, "the stale remembered URL was dialed");
    }
}
