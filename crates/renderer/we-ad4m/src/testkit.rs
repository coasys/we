//! A real executor for live tests (feature `testkit`): spawn, connect, seed
//! a perspective. Shared by this crate's tests and `we-app`'s.
//!
//! The binary is `EXECUTOR_PATH`, as in `ad4m-client`'s own integration
//! tests. Without it the tests print a skip and pass — unless
//! `AD4M_REQUIRE_EXECUTOR=1`, which makes a missing binary a failure.
//!
//! Each executor gets its own temporary data directory and a free port, and
//! is killed when the handle drops: these tests never touch an executor they
//! did not start.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::{Connection, Runtime};
use serde_json::{json, Value};

pub fn require_binary() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("EXECUTOR_PATH") {
        let p = PathBuf::from(p);
        assert!(p.exists(), "EXECUTOR_PATH does not exist: {}", p.display());
        return Some(p);
    }
    assert!(
        !std::env::var("AD4M_REQUIRE_EXECUTOR").is_ok_and(|v| v != "0" && !v.is_empty()),
        "AD4M_REQUIRE_EXECUTOR is set but EXECUTOR_PATH is not"
    );
    eprintln!("SKIP: set EXECUTOR_PATH to an ad4m-executor binary to run the live tests");
    None
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

pub struct Executor {
    child: Child,
    pub url: String,
    pub port: u16,
    _data: tempfile::TempDir,
}

impl Drop for Executor {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A single-user executor with no admin credential: an anonymous loopback
/// caller is the operator, so no capability request is needed.
pub fn start_executor() -> Option<Executor> {
    start(None)
}

/// `--admin-credential <credential>`: an anonymous app must ask for a
/// capability, as against the launcher; `credential` as the token is the
/// operator, who approves.
pub fn start_executor_with_admin(credential: &str) -> Option<Executor> {
    start(Some(credential))
}

fn start(admin: Option<&str>) -> Option<Executor> {
    let binary = require_binary()?;
    let data = tempfile::tempdir().unwrap();
    let port = free_port();
    let seed = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata/bootstrapSeed.json");
    let init = Command::new(&binary)
        .args(["init", "--data-path"])
        .arg(data.path())
        .arg("--network-bootstrap-seed")
        .arg(&seed)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("ad4m-executor init");
    assert!(init.success(), "ad4m-executor init failed");
    let log = std::env::var("WE_AD4M_EXECUTOR_LOG").ok();
    let mut cmd = Command::new(&binary);
    cmd.arg("run");
    match admin {
        Some(c) => cmd.args(["--admin-credential", c]),
        None => cmd.arg("--insecure-no-admin-credential"),
    };
    let child = cmd
        .arg("--app-data-path")
        .arg(data.path())
        .args(["--port", &port.to_string()])
        .args(["--run-holochain", "false"])
        .args(["--language-language-only", "true"])
        .args(["--run-dapp-server", "false"])
        .env("AD4M_EXIT_WITH_PARENT", "true")
        .stdout(Stdio::null())
        .stderr(match &log {
            Some(path) => Stdio::from(std::fs::File::create(path).unwrap()),
            None => Stdio::null(),
        })
        .spawn()
        .expect("spawn ad4m-executor");
    Some(Executor {
        child,
        url: format!("http://127.0.0.1:{port}"),
        port,
        _data: data,
    })
}

/// Poll the socket until the executor takes it.
pub fn connect(rt: &Runtime, url: &str) -> Connection {
    connect_as(rt, url, "")
}

/// [`connect`] with a token — the admin credential for the operator.
pub fn connect_as(rt: &Runtime, url: &str, token: &str) -> Connection {
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        match rt.block_on(Connection::open(rt.handle(), url, token)) {
            Ok(c) => return c,
            Err(e) => {
                assert!(
                    Instant::now() < deadline,
                    "executor did not come up in 120s: {e}"
                );
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
}

/// The smallest WE-shaped `CollectionBlock`: `kind` and `title` under WE's
/// own predicates, so a template's `{ entity: "CollectionBlock", where:
/// { kind: "post" } }` reads it as WE writes it.
pub const COLLECTION_SDNA: &str = r#"{
  "target_class": "we://CollectionBlock",
  "constructor_actions": [
    {"action": "addLink", "source": "this", "predicate": "we://kind", "target": "placeholder"}
  ],
  "properties": [
    {"path": "we://kind", "name": "kind", "min_count": 1, "max_count": 1, "setter": [{"action": "setSingleTarget", "source": "this", "predicate": "we://kind", "target": "value"}]},
    {"path": "we://title", "name": "title", "min_count": 0, "max_count": 1, "setter": [{"action": "setSingleTarget", "source": "this", "predicate": "we://title", "target": "value"}]}
  ]
}"#;

/// Mint the agent and add an empty perspective. Returns its uuid.
pub fn new_space(rt: &Runtime, conn: &Connection, name: &str) -> String {
    let client = conn.client();
    rt.block_on(async {
        let status = client.agent.generate("passphrase".into()).await.unwrap();
        assert!(status.is_unlocked);
        client.perspectives.add(name.into()).await.unwrap().uuid
    })
}

/// [`new_space`] with `CollectionBlock` installed. Returns the uuid.
pub fn seed_space(rt: &Runtime, conn: &Connection, name: &str) -> String {
    let uuid = new_space(rt, conn, name);
    add_class(rt, conn, &uuid, "CollectionBlock", COLLECTION_SDNA);
    uuid
}

/// A post, written by another client as links: the constructor link
/// (`we://kind`) and the title. Links rather than `perspective.instanceCreate`
/// because the executor the tests run against may predate the validated
/// write RPC (A3); the subscription answers to links either way.
pub fn create_post(rt: &Runtime, conn: &Connection, uuid: &str, title: &str) {
    create_collection(rt, conn, uuid, "post", title);
}

/// A `CollectionBlock` of `kind` — a post, a call, a channel — as links.
pub fn create_collection(rt: &Runtime, conn: &Connection, uuid: &str, kind: &str, title: &str) {
    use ad4m_client::literal::Literal;
    use ad4m_client::types::LinkInput;
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let base = format!("e7test://{kind}/{}-{n}", std::process::id());
    let client = conn.client();
    rt.block_on(async {
        for (predicate, value) in [("we://kind", kind), ("we://title", title)] {
            let target = Literal::from_string(value.to_string()).to_url().unwrap();
            client
                .perspectives
                .add_link(
                    uuid.to_string(),
                    LinkInput {
                        source: base.clone(),
                        predicate: Some(predicate.to_string()),
                        target,
                    },
                )
                .await
                .unwrap();
        }
    });
}

/// WE's `Space`, cut to what the live rows read: `uuid` and `root`.
pub const SPACE_SDNA: &str = r#"{
  "target_class": "we://Space",
  "constructor_actions": [
    {"action": "addLink", "source": "this", "predicate": "we://uuid", "target": "placeholder"}
  ],
  "properties": [
    {"path": "we://uuid", "name": "uuid", "min_count": 1, "max_count": 1, "setter": [{"action": "setSingleTarget", "source": "this", "predicate": "we://uuid", "target": "value"}]},
    {"path": "we://name", "name": "name", "min_count": 0, "max_count": 1, "setter": [{"action": "setSingleTarget", "source": "this", "predicate": "we://name", "target": "value"}]},
    {"path": "we://root", "name": "root", "node_kind": "IRI", "min_count": 0, "max_count": 1, "setter": [{"action": "setSingleTarget", "source": "this", "predicate": "we://root", "target": "value"}]}
  ]
}"#;

/// Install one more class into a perspective.
pub fn add_class(rt: &Runtime, conn: &Connection, uuid: &str, name: &str, shacl: &str) {
    rt.block_on(conn.ws().call::<Value>(
        "perspective.addSdna",
        json!({ "uuid": uuid, "name": name, "sdnaCode": "", "sdnaType": "subject_class", "shaclJson": shacl }),
    ))
    .unwrap();
}

/// Add links `source --predicate--> target`, targets as given (literal URLs
/// or IRIs).
pub fn add_links(
    rt: &Runtime,
    conn: &Connection,
    uuid: &str,
    source: &str,
    links: &[(&str, String)],
) {
    use ad4m_client::types::LinkInput;
    let client = conn.client();
    rt.block_on(async {
        for (predicate, target) in links {
            client
                .perspectives
                .add_link(
                    uuid.to_string(),
                    LinkInput {
                        source: source.to_string(),
                        predicate: Some(predicate.to_string()),
                        target: target.clone(),
                    },
                )
                .await
                .unwrap();
        }
    });
}

pub fn literal(s: &str) -> String {
    ad4m_client::literal::Literal::from_string(s.to_string())
        .to_url()
        .unwrap()
}
