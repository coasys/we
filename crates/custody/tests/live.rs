//! The custody service end to end (make an identity, add a second device, revoke it): a real
//! identity-store, executor A as this computer's (with an admin credential), executor B as a second
//! one named as operated by the identity, and the custody service driving them the way the identity
//! window does — screen by screen.
//!
//! Skipped unless `CUSTODY_LIVE=1`. It needs an ad4m checkout at the commit WE pins (`AD4M_REPO`,
//! default `../ad4m` beside this repository) with:
//!
//! ```sh
//! cargo build --release --bin ad4m-executor
//! cargo build -p identity-store
//! cd tests/js && pnpm run prepare-test-local   # publishes the centralized agent language
//! ```
//!
//! Then, from `crates/custody`:
//!
//! ```sh
//! CUSTODY_LIVE=1 AD4M_REPO=<ad4m> cargo test --features cheap-kdf --test live -- --nocapture
//! ```
//!
//! The executors run in `<ad4m>/tests/js` with its shared language directories, as ad4m's own
//! identity suite runs them (`tests/js/tests/identity.test.ts`), and without Holochain.

use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use ad4m_client::ws_rpc::WsRpcClient;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use we_custody::seal::{self, Kdf};
use we_custody::store::{item_name, FileStore, SecretStore};
use we_custody::{
    spawn, DesktopVault, ExecutorAddress, IdentityStep, PendingIncepts, Screen, StepInput,
};

const PASSPHRASE: &str = "a long passphrase for the test";
const CHEAP: Kdf = Kdf {
    m_kib: 64,
    t: 1,
    p: 1,
};

fn ad4m_repo() -> PathBuf {
    std::env::var("AD4M_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../ad4m"))
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// A child process that is killed when the test lets go of it, with its output as lines.
struct Proc {
    child: Child,
    lines: mpsc::Receiver<String>,
    seen: Vec<String>,
}

impl Proc {
    fn spawn(mut command: Command, label: &'static str) -> Proc {
        let mut child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect(label);
        let (tx, lines) = mpsc::channel();
        for stream in [
            Box::new(child.stdout.take().unwrap()) as Box<dyn std::io::Read + Send>,
            Box::new(child.stderr.take().unwrap()),
        ] {
            let tx = tx.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stream).lines().map_while(Result::ok) {
                    if std::env::var("CUSTODY_LIVE_VERBOSE").is_ok() {
                        eprintln!("[{label}] {line}");
                    }
                    let _ = tx.send(line);
                }
            });
        }
        Proc {
            child,
            lines,
            seen: Vec::new(),
        }
    }

    /// The first line `matches` accepts, within `secs`.
    fn wait_for(&mut self, secs: u64, matches: impl Fn(&str) -> bool) -> String {
        if let Some(line) = self.seen.iter().find(|l| matches(l)) {
            return line.clone();
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(secs);
        while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
            match self.lines.recv_timeout(left) {
                Ok(line) => {
                    self.seen.push(line.clone());
                    if matches(&line) {
                        return line;
                    }
                }
                Err(_) => break,
            }
        }
        panic!(
            "no expected line in {secs} s; last lines:\n{}",
            self.seen
                .iter()
                .rev()
                .take(30)
                .rev()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
        );
    }
}

impl Drop for Proc {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The executor's language address for a bundle (`calculate_language_hash`), as ad4m's test
/// helper `languageAddress` computes it.
fn language_address(bundle: &str) -> String {
    let digest = Sha256::digest(bundle.as_bytes());
    let mut cid = vec![0x01, 0x00, 0x12, 0x20];
    cid.extend_from_slice(&digest);
    format!("Qmz{}", bs58::encode(cid).into_string())
}

fn write_settings(data: &Path, address: &str, storage: &Path) {
    let dir = data.join("ad4m/languages").join(address);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::create_dir_all(storage).unwrap();
    std::fs::write(
        dir.join("settings.json"),
        json!({ "storagePath": storage }).to_string(),
    )
    .unwrap();
}

struct Node {
    port: u16,
    token: String,
    _proc: Proc,
}

impl Node {
    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    async fn call(&self, method: &str, params: Value) -> Value {
        let client = WsRpcClient::connect(&self.url(), &self.token)
            .await
            .unwrap();
        client
            .call::<Value>(method, params)
            .await
            .unwrap_or_else(|e| panic!("{method}: {e}"))
    }
}

struct World {
    repo: PathBuf,
    dir: PathBuf,
    seed: PathBuf,
    store_url: String,
    store_key: String,
}

impl World {
    fn executor(&self) -> PathBuf {
        self.repo.join("target/release/ad4m-executor")
    }

    /// `init` (with `--operator` for B), shared stores as ad4m's suite sets them, `run`, then an agent.
    async fn start_node(
        &self,
        name: &str,
        operator: Option<&str>,
        credential: Option<&str>,
    ) -> Node {
        let js = self.repo.join("tests/js");
        let data = self.dir.join(name);
        let mut init = Command::new(self.executor());
        init.current_dir(&js)
            .args(["init", "--data-path"])
            .arg(&data)
            .arg("--network-bootstrap-seed")
            .arg(&self.seed);
        if let Some(did) = operator {
            init.args(["--operator", did]);
        }
        assert!(init.status().unwrap().success(), "init {name}");

        let seed: Value =
            serde_json::from_str(&std::fs::read_to_string(&self.seed).unwrap()).unwrap();
        let shared = js.join("tst-tmp");
        if let Some(bundle) = seed["languageLanguageBundle"].as_str() {
            write_settings(&data, &language_address(bundle), &shared.join("languages"));
        }
        if let Some(address) = seed["neighbourhoodLanguage"].as_str() {
            write_settings(&data, address, &shared.join("neighbourhoods"));
        }
        if let Some(address) = seed["agentLanguage"].as_str() {
            write_settings(&data, address, &shared.join("agent-profiles"));
        }

        let port = free_port();
        let mut run = Command::new(self.executor());
        run.current_dir(&js)
            .args(["run", "--app-data-path"])
            .arg(&data)
            .args([
                "--port",
                &port.to_string(),
                "--language-language-only",
                "false",
                "--run-dapp-server",
                "false",
                "--run-holochain",
                "false",
            ])
            .env("AD4M_IDENTITY_STORE_URL", &self.store_url)
            .env("AD4M_IDENTITY_STORE_KEYS", &self.store_key);
        match credential {
            // The admin credential in the environment, as the desktop shell passes it.
            Some(c) => {
                run.env("AD4M_ADMIN_CREDENTIAL", c);
            }
            None => {
                run.arg("--insecure-no-admin-credential");
            }
        }
        let mut proc = Proc::spawn(run, "executor");
        let ready = [
            format!("API server starting on http://127.0.0.1:{port}/api/v1"),
            format!("listening on http://127.0.0.1:{port}"),
        ];
        proc.wait_for(180, |l| ready.iter().any(|m| l.contains(m.as_str())));
        let node = Node {
            port,
            token: credential.unwrap_or_default().to_string(),
            _proc: proc,
        };
        node.call("agent.generate", json!({ "passphrase": "passphrase" }))
            .await;
        node
    }
}

/// What every screen sent to the identity window said, as JSON, to look for secrets in afterwards.
#[derive(Default)]
struct Shown(Vec<String>);

impl Shown {
    fn record(&mut self, screen: &Screen) -> Screen {
        self.0.push(serde_json::to_string(screen).unwrap());
        screen.clone()
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn make_link_and_revoke_through_the_custody_service() {
    if std::env::var("CUSTODY_LIVE").as_deref() != Ok("1") {
        eprintln!("skipped: set CUSTODY_LIVE=1 (see the header of tests/live.rs)");
        return;
    }
    assert!(cfg!(feature = "cheap-kdf"), "run with --features cheap-kdf");
    let repo = ad4m_repo();
    let js = repo.join("tests/js");
    let agent_language =
        std::fs::read_to_string(js.join("scripts/centralized-agent-language-hash"))
            .expect("run `pnpm run prepare-test-local` in <ad4m>/tests/js first")
            .trim()
            .to_string();

    let dir = tempfile::tempdir().unwrap();
    // The seed ad4m's identity suite last wrote, when there is one: `prepare-test-local` publishes
    // the languages it names. Otherwise the checked-in seed with the agent language swapped in, as
    // that suite's `writeIdentitySeed` does.
    let prepared = js.join("tst-tmp/identityBootstrapSeed.json");
    let source = if prepared.exists() {
        prepared
    } else {
        js.join("bootstrapSeed.json")
    };
    let mut seed: Value = serde_json::from_str(&std::fs::read_to_string(source).unwrap()).unwrap();
    seed["agentLanguage"] = json!(agent_language);
    let seed_path = dir.path().join("seed.json");
    std::fs::write(&seed_path, seed.to_string()).unwrap();

    // The identity store, on a temp database, with a cheap proof of work.
    let store_port = free_port();
    let mut store = Command::new(repo.join("target/debug/identity-store"));
    store
        .arg("serve")
        .env("IDENTITY_STORE_DB", dir.path().join("store.sqlite"))
        .env("IDENTITY_STORE_KEY", dir.path().join("store-key"))
        .env("IDENTITY_STORE_LISTEN", format!("127.0.0.1:{store_port}"))
        .env("POW_BITS", "8");
    let mut store = Proc::spawn(store, "identity-store");
    let ready = store.wait_for(30, |l| l.starts_with("identity-store listening on "));
    let parts: Vec<&str> = ready.split_whitespace().collect();
    let world = World {
        repo: repo.clone(),
        dir: dir.path().to_path_buf(),
        seed: seed_path,
        store_url: parts[3].to_string(),
        store_key: parts[5].to_string(),
    };

    let credential = "custody-live-admin-credential";
    let a = world.start_node("a", None, Some(credential)).await;

    let vault_dir = dir.path().join("custody");
    let vault = DesktopVault::with_kdf(
        Box::new(FileStore::new(&vault_dir)),
        PendingIncepts::file(&vault_dir),
        CHEAP,
    );
    let custody = spawn(
        vault,
        ExecutorAddress {
            url: a.url(),
            admin_credential: Arc::from(credential),
            store_url: Some(world.store_url.clone()),
            // The executors here are started with the store's key (`AD4M_IDENTITY_STORE_KEYS`).
            store_trusted: true,
        },
    );
    let mut shown = Shown::default();

    // ─── 1. Make my identity here ───
    let Screen::ShowWords { words } =
        shown.record(&custody.start(IdentityStep::Create).await.unwrap())
    else {
        panic!("create did not start on the words")
    };
    assert_eq!(words.len(), 12);
    let Screen::ConfirmWords { positions, .. } =
        shown.record(&custody.step(StepInput::WordsWritten).await.unwrap())
    else {
        panic!("no confirm-words")
    };
    assert_ne!(positions[0], positions[1]);
    // A wrong pair asks again, for the same places.
    let again = shown.record(
        &custody
            .step(StepInput::Words {
                answers: ["nope".into(), "nope".into()],
            })
            .await
            .unwrap(),
    );
    assert!(
        matches!(&again, Screen::ConfirmWords { positions: p, error: Some(_) } if *p == positions)
    );
    let answers = [
        words[positions[0] - 1].clone(),
        words[positions[1] - 1].clone(),
    ];
    let set = shown.record(&custody.step(StepInput::Words { answers }).await.unwrap());
    assert!(
        matches!(set, Screen::SetPassphrase { error: None }),
        "{set:?}"
    );
    let short = shown.record(
        &custody
            .step(StepInput::Passphrase {
                passphrase: "short".into(),
                confirm: Some("short".into()),
            })
            .await
            .unwrap(),
    );
    assert!(matches!(short, Screen::SetPassphrase { error: Some(_) }));
    let ready = shown.record(
        &custody
            .step(StepInput::Passphrase {
                passphrase: PASSPHRASE.into(),
                confirm: Some(PASSPHRASE.into()),
            })
            .await
            .unwrap(),
    );
    let Screen::IdentityReady { did, key_id } = ready else {
        panic!("not ready: {ready:?}")
    };
    assert!(did.starts_with("did:scid:coasys:1:"));
    assert_eq!(key_id, "d1");

    // The executor speaks for it, and the key log lists `incept` with d1.
    let status = a.call("identity.status", json!({})).await;
    assert_eq!(status["did"], did);
    assert_eq!(status["keyId"], "d1");
    let log = a
        .call(
            "identity.log",
            json!({ "did": did, "from": 0, "fresh": true }),
        )
        .await;
    let ops: Vec<&str> = log["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["op"].as_str().unwrap())
        .collect();
    assert_eq!(ops, ["incept"]);
    let public = custody.public_state().await.unwrap();
    assert_eq!(public.did.as_deref(), Some(did.as_str()));
    assert!(public.holds_master.is_some());

    // ─── 2. A second executor, named as operated by the identity, joins it ───
    let b = world.start_node("b", Some(&did), None).await;
    let enter = shown.record(&custody.start(IdentityStep::AddDevice).await.unwrap());
    assert!(matches!(enter, Screen::EnterPassphrase { error: None }));
    let wrong = shown.record(
        &custody
            .step(StepInput::Passphrase {
                passphrase: "not the passphrase at all".into(),
                confirm: None,
            })
            .await
            .unwrap(),
    );
    assert!(
        matches!(wrong, Screen::EnterPassphrase { error: Some(_) }),
        "{wrong:?}"
    );
    let offer = shown.record(
        &custody
            .step(StepInput::Passphrase {
                passphrase: PASSPHRASE.into(),
                confirm: None,
            })
            .await
            .unwrap(),
    );
    let Screen::Offer { link, qr_svg, .. } = offer else {
        panic!("no offer: {offer:?}")
    };
    assert!(link.starts_with("https://coasys.id/o#coasys:offer:1:"));
    assert!(qr_svg.contains("<svg"));

    let mut claim_cmd = Command::new(world.executor());
    claim_cmd.current_dir(&js).args([
        "--executor-url",
        &b.url(),
        "claim",
        &link,
        "--hint",
        "server b",
    ]);
    let mut claim = Proc::spawn(claim_cmd, "claim");
    let waiting = tokio::spawn({
        let custody = custody.clone();
        async move { custody.step(StepInput::WaitClaim).await }
    });
    let b_code = claim
        .wait_for(60, |l| l.starts_with("Match code: "))
        .trim_start_matches("Match code: ")
        .trim()
        .to_string();
    let matched = shown.record(&waiting.await.unwrap().unwrap());
    let Screen::Match { code, hint } = matched else {
        panic!("no match: {matched:?}")
    };
    assert_eq!(code, b_code, "both sides show the same code");
    assert_eq!(hint.as_deref(), Some("server b"));
    let linked = shown.record(&custody.step(StepInput::Confirm).await.unwrap());
    assert!(matches!(linked, Screen::Linked { seq: 1 }), "{linked:?}");
    claim.wait_for(60, |l| l.starts_with(&format!("Joined {did} as d2")));
    let b_status = b.call("identity.status", json!({})).await;
    assert_eq!(
        (b_status["did"].as_str(), b_status["keyId"].as_str()),
        (Some(did.as_str()), Some("d2"))
    );

    // ─── 4. Revoke d2 ───
    let confirm = shown.record(
        &custody
            .start(IdentityStep::Revoke {
                key_id: "d2".into(),
            })
            .await
            .unwrap(),
    );
    assert!(
        matches!(&confirm, Screen::RevokeConfirm { key_id, passphrase: true, .. } if key_id == "d2")
    );
    let wrong = shown.record(
        &custody
            .step(StepInput::Revoke {
                passphrase: Some("still not the passphrase".into()),
            })
            .await
            .unwrap(),
    );
    assert!(matches!(
        wrong,
        Screen::RevokeConfirm { error: Some(_), .. }
    ));
    let revoked = shown.record(
        &custody
            .step(StepInput::Revoke {
                passphrase: Some(PASSPHRASE.into()),
            })
            .await
            .unwrap(),
    );
    assert!(
        matches!(&revoked, Screen::Revoked { key_id, seq: 2 } if key_id == "d2"),
        "{revoked:?}"
    );
    let log = a
        .call(
            "identity.log",
            json!({ "did": did, "from": 0, "fresh": true }),
        )
        .await;
    let ops: Vec<&str> = log["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["op"].as_str().unwrap())
        .collect();
    assert_eq!(ops, ["incept", "add", "revoke"]);
    let devices = a.call("identity.devices", json!({})).await;
    let d2 = devices
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["keyId"] == "d2")
        .unwrap();
    assert_eq!(d2["revokedSeq"], 2);
    let b_status = b.call("identity.status", json!({})).await;
    assert_eq!(
        b_status["revoked"], 2,
        "the second executor reports its key revoked"
    );
    // This computer cannot revoke itself.
    assert!(matches!(
        custody
            .start(IdentityStep::Revoke {
                key_id: "d1".into()
            })
            .await
            .unwrap(),
        Screen::Failed { .. }
    ));

    // ─── No master key leaves custody ───
    let scid = did.rsplit(':').next().unwrap();
    let sealed = FileStore::new(&vault_dir)
        .get(&item_name(scid))
        .unwrap()
        .expect("the custody item");
    let item = seal::open(&sealed, scid, PASSPHRASE).unwrap();
    let master = *item.master;
    assert!(
        !sealed.windows(32).any(|w| w == master),
        "the master key rests sealed"
    );
    let forms = [
        bs58::encode(master).into_string(),
        master
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>(),
        serde_json::to_string(&master.to_vec()).unwrap(),
    ];
    for screen in &shown.0 {
        for form in &forms {
            assert!(
                !screen.contains(form.as_str()),
                "a screen carried the master key: {screen}"
            );
        }
        assert!(
            !screen.contains(PASSPHRASE),
            "a screen carried the passphrase"
        );
    }
    // Nor does the public state, which the main window reads.
    let public = serde_json::to_string(&custody.public_state().await.unwrap()).unwrap();
    for form in &forms {
        assert!(!public.contains(form.as_str()));
    }
}
