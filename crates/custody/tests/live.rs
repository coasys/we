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
//!
//! A second case starts a desktop executor the way the desktop apps do: `--custody-channel`, the
//! custody credential as the first line of its stdin, and no `--operator`. Its first link, made
//! through its own custody service ("Show code" entered on the holder), records the operator
//! when it joins: while bound, an offer of another identity is refused `already-linked`, and once
//! its key is revoked, `first-link`.
//!
//! A third case adds a bot: the holder's custody service opens a bot offer (`add-bot`), a desktop
//! executor makes the bot agent from it (`bot.createAgent`), and both show the same match code.
//! With one of two neighbourhoods in its grant, the bot joins and writes there with its reasons and
//! is refused in the other; paused it is refused, revoked it is refused for good, and its activity
//! log keeps each call it made, newest first.
//!
//! The cases run one at a time: each starts its own store and executors.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use ad4m_client::ws_rpc::WsRpcClient;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use we_custody::seal::{self, Kdf};
use we_custody::store::{item_name, FileStore, SecretStore};
use we_custody::{
    spawn, CustodyHandle, DesktopVault, ExecutorAddress, IdentityStep, PendingIncepts, Screen,
    StepInput,
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
    /// Held open while the process runs, when it was given a first line.
    _stdin: Option<ChildStdin>,
}

impl Proc {
    fn spawn(command: Command, label: &'static str) -> Proc {
        Proc::spawn_with_line(command, label, None)
    }

    /// Spawns, and when `first_line` is given writes it and a newline to the process's stdin,
    /// which then stays open — as the desktop apps hand an executor its custody credential.
    fn spawn_with_line(
        mut command: Command,
        label: &'static str,
        first_line: Option<&str>,
    ) -> Proc {
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        if first_line.is_some() {
            command.stdin(Stdio::piped());
        }
        let mut child = command.spawn().expect(label);
        let stdin = first_line.map(|line| {
            let mut stdin = child.stdin.take().unwrap();
            stdin.write_all(format!("{line}\n").as_bytes()).unwrap();
            stdin.flush().unwrap();
            stdin
        });
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
            _stdin: stdin,
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
        self.try_call(method, params)
            .await
            .unwrap_or_else(|e| panic!("{method}: {e}"))
    }

    /// The call's answer, or its error as the executor said it.
    async fn try_call(&self, method: &str, params: Value) -> Result<Value, String> {
        let client = WsRpcClient::connect(&self.url(), &self.token)
            .await
            .unwrap();
        client
            .call::<Value>(method, params)
            .await
            .map_err(|e| e.to_string())
    }
}

struct World {
    repo: PathBuf,
    dir: PathBuf,
    seed: PathBuf,
    store_url: String,
    store_key: String,
    /// Stopped before the folder it writes to is removed (fields drop in order).
    _store: Proc,
    _tmp: tempfile::TempDir,
}

impl World {
    fn executor(&self) -> PathBuf {
        self.repo.join("target/release/ad4m-executor")
    }

    /// `init` (with `--operator` for B), shared stores as ad4m's suite sets them, `run`, then an agent.
    /// With `custody`, the executor runs as a desktop app runs it: `--custody-channel` and
    /// `--watch-stdin`, the custody credential the first line of its stdin, which stays open.
    async fn start_node(
        &self,
        name: &str,
        operator: Option<&str>,
        credential: Option<&str>,
        custody: Option<&str>,
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
        if custody.is_some() {
            run.args(["--custody-channel", "true", "--watch-stdin", "true"]);
        }
        let mut proc = Proc::spawn_with_line(run, "executor", custody);
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

/// Held by each case while it runs: each starts a store and executors of its own.
static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// The temp folder, the seed and a running identity store, or `None` when the live cases are not
/// asked for. The guard keeps the other case waiting until this one ends.
async fn set_up() -> Option<(tokio::sync::MutexGuard<'static, ()>, World)> {
    if std::env::var("CUSTODY_LIVE").as_deref() != Ok("1") {
        eprintln!("skipped: set CUSTODY_LIVE=1 (see the header of tests/live.rs)");
        return None;
    }
    if !cfg!(feature = "cheap-kdf") {
        panic!("run with --features cheap-kdf");
    }
    let one = ONE_AT_A_TIME.lock().await;
    let repo = ad4m_repo();
    let js = repo.join("tests/js");
    let agent_language =
        std::fs::read_to_string(js.join("scripts/centralized-agent-language-hash"))
            .expect("run `pnpm run prepare-test-local` in <ad4m>/tests/js first")
            .trim()
            .to_string();

    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().to_path_buf();
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
    let seed_path = dir.join("seed.json");
    std::fs::write(&seed_path, seed.to_string()).unwrap();

    // The identity store, on a temp database, with a cheap proof of work.
    let store_port = free_port();
    let mut store = Command::new(repo.join("target/debug/identity-store"));
    store
        .arg("serve")
        .env("IDENTITY_STORE_DB", dir.join("store.sqlite"))
        .env("IDENTITY_STORE_KEY", dir.join("store-key"))
        .env("IDENTITY_STORE_LISTEN", format!("127.0.0.1:{store_port}"))
        .env("POW_BITS", "8");
    let mut store = Proc::spawn(store, "identity-store");
    let ready = store.wait_for(30, |l| l.starts_with("identity-store listening on "));
    let parts: Vec<&str> = ready.split_whitespace().collect();
    let (store_url, store_key) = (parts[3].to_string(), parts[5].to_string());
    Some((
        one,
        World {
            repo,
            dir,
            seed: seed_path,
            store_url,
            store_key,
            _store: store,
            _tmp: tmp,
        },
    ))
}

/// A custody service over the executor at `url`, its vault (sealed files, a cheap KDF) in `dir`.
fn custody_on(url: String, credential: &str, dir: &Path) -> CustodyHandle {
    let vault = DesktopVault::with_kdf(
        Box::new(FileStore::new(dir)),
        PendingIncepts::file(dir),
        CHEAP,
    );
    spawn(
        vault,
        ExecutorAddress {
            url,
            credential: Arc::from(credential),
        },
    )
}

/// "Make my identity here", answered right the first time: the identity's DID.
async fn make_identity(custody: &CustodyHandle) -> String {
    let Screen::ShowWords { words } = custody.start(IdentityStep::Create).await.unwrap() else {
        panic!("create did not start on the words")
    };
    let Screen::ConfirmWords { positions, .. } =
        custody.step(StepInput::WordsWritten).await.unwrap()
    else {
        panic!("no confirm-words")
    };
    let answers = [
        words[positions[0] - 1].clone().into(),
        words[positions[1] - 1].clone().into(),
    ];
    let set = custody.step(StepInput::Words { answers }).await.unwrap();
    assert!(
        matches!(set, Screen::SetPassphrase { error: None }),
        "{set:?}"
    );
    let ready = custody
        .step(StepInput::Passphrase {
            passphrase: PASSPHRASE.into(),
            confirm: Some(PASSPHRASE.into()),
        })
        .await
        .unwrap();
    let Screen::IdentityReady { did, .. } = ready else {
        panic!("not ready: {ready:?}")
    };
    did
}

#[tokio::test(flavor = "multi_thread")]
async fn make_link_and_revoke_through_the_custody_service() {
    let Some((_one, world)) = set_up().await else {
        return;
    };
    let js = world.repo.join("tests/js");

    let credential = "custody-live-admin-credential";
    let a = world.start_node("a", None, Some(credential), None).await;

    let vault_dir = world.dir.join("custody");
    let custody = custody_on(a.url(), credential, &vault_dir);
    let mut shown = Shown::default();
    // The executors are started with the store and its key (`AD4M_IDENTITY_STORE_URL`/`KEYS`),
    // which win over the seed's: custody learns the store from `identity.status`, and is not
    // blocked.
    assert_eq!(custody.public_state().await.unwrap().blocked, None);

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
        words[positions[0] - 1].clone().into(),
        words[positions[1] - 1].clone().into(),
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
    let b = world.start_node("b", Some(&did), None, None).await;
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
    assert!(link.starts_with("https://id.coasys.org/o#coasys:offer:1:"));
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
    let Screen::Match {
        code,
        hint,
        can_keep,
        own_name,
    } = matched
    else {
        panic!("no match: {matched:?}")
    };
    assert_eq!(code, b_code, "both sides show the same code");
    assert_eq!(hint.as_deref(), Some("server b"));
    // A node offer: the server may not keep the master key. The first link names this computer.
    assert!(!can_keep);
    assert!(own_name);
    let confirm = StepInput::Confirm {
        name: None,
        keep_master: false,
        this_name: Some("Node A".into()),
    };
    let linked = shown.record(&custody.step(confirm).await.unwrap());
    assert!(
        matches!(
            linked,
            Screen::Linked {
                seq: 1,
                master_sent: false,
                note: None
            }
        ),
        "{linked:?}"
    );
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
                rotate: false,
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
                rotate: false,
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

/// A desktop executor — `--custody-channel` with the custody credential on stdin, no `--operator`,
/// so no operator record — joins the identity of the first holder that links it, through its own
/// custody service as the desktop apps run it ("Show code" here, "Enter code" on the
/// holder). Its join records the operator (`FirstRun`; the claim alone records nothing): while
/// bound an offer of another identity is refused `already-linked`, and after the holder revokes
/// its key, `first-link` — before anything reaches the store.
#[tokio::test(flavor = "multi_thread")]
async fn a_desktop_executor_takes_its_first_link_as_its_operator() {
    let Some((_one, world)) = set_up().await else {
        return;
    };

    // A: a computer keeping the master key of the identity B joins.
    let a_admin = "custody-live-a-admin";
    let a = world.start_node("a", None, Some(a_admin), None).await;
    let holder = custody_on(a.url(), a_admin, &world.dir.join("custody-a"));
    let did = make_identity(&holder).await;

    // C: another person's computer, with an identity of its own and an offer of it.
    let c_admin = "custody-live-c-admin";
    let c = world.start_node("c", None, Some(c_admin), None).await;
    let stranger = custody_on(c.url(), c_admin, &world.dir.join("custody-c"));
    let other_did = make_identity(&stranger).await;
    assert_ne!(other_did, did);
    let enter = stranger.start(IdentityStep::AddDevice).await.unwrap();
    assert!(
        matches!(enter, Screen::EnterPassphrase { error: None }),
        "{enter:?}"
    );
    let offer = stranger
        .step(StepInput::Passphrase {
            passphrase: PASSPHRASE.into(),
            confirm: None,
        })
        .await
        .unwrap();
    let Screen::Offer {
        link: other_offer, ..
    } = offer
    else {
        panic!("no offer: {offer:?}")
    };

    // B: the desktop executor, and its custody service on the custody credential alone.
    let (b_admin, b_custody) = ("custody-live-b-admin", "custody-live-b-custody");
    let b = world
        .start_node("b", None, Some(b_admin), Some(b_custody))
        .await;
    let device = custody_on(b.url(), b_custody, &world.dir.join("custody-b"));
    let shown = device.start(IdentityStep::ShowCode).await.unwrap();
    let Screen::DeviceCode {
        code: device_code, ..
    } = shown
    else {
        panic!("no device code: {shown:?}")
    };
    assert!(device_code.contains("coasys:device:1:"), "{device_code}");

    // The holder scans B's code and sends it the offer; B's executor claims it from its inbox.
    let enter = holder.start(IdentityStep::ScanDevice).await.unwrap();
    assert!(
        matches!(enter, Screen::EnterCode { error: None }),
        "{enter:?}"
    );
    let unlock = holder
        .step(StepInput::Code { code: device_code })
        .await
        .unwrap();
    assert!(
        matches!(unlock, Screen::EnterPassphrase { error: None }),
        "{unlock:?}"
    );
    let sent = holder
        .step(StepInput::Passphrase {
            passphrase: PASSPHRASE.into(),
            confirm: None,
        })
        .await
        .unwrap();
    assert!(matches!(sent, Screen::CodeSent { .. }), "{sent:?}");
    let (matched, device_matched) = tokio::join!(
        holder.step(StepInput::WaitClaim),
        device.step(StepInput::WaitLink)
    );
    let matched = matched.unwrap();
    let Screen::Match { code, can_keep, .. } = matched else {
        panic!("no match: {matched:?}")
    };
    let device_matched = device_matched.unwrap();
    let Screen::DeviceMatch {
        code: device_shows,
        did: joining,
        needs_accept,
        ..
    } = device_matched
    else {
        panic!("no device match: {device_matched:?}")
    };
    assert_eq!(code, device_shows, "both sides show the same code");
    assert_eq!(joining, did);
    // Claimed over the custody channel: a desktop app may keep the master key.
    assert!(can_keep);

    // The claim records nothing yet: until B joins, a claim that never completes (the wrong code
    // scanned, the holder said No) leaves B free to claim again. Nothing here claims C's offer
    // before the join, so B's own join is the only one in flight.

    // The holder confirms, and B joins the identity — which records it as B's operator. Where B's
    // executor binds only once the person accepts the identity there (a first run), B accepts
    // first, and the accept waits for the join.
    let (linked, joined) = tokio::join!(
        holder.step(StepInput::Confirm {
            name: Some("Desktop B".into()),
            keep_master: false,
            this_name: Some("Desktop A".into()),
        }),
        device.step(if needs_accept {
            StepInput::Accept
        } else {
            StepInput::WaitJoin
        })
    );
    let linked = linked.unwrap();
    assert!(
        matches!(
            linked,
            Screen::Linked {
                seq: 1,
                master_sent: false,
                ..
            }
        ),
        "{linked:?}"
    );
    let joined = joined.unwrap();
    assert!(
        matches!(&joined, Screen::Joined { did: d, key_id } if *d == did && key_id == "d2"),
        "{joined:?}"
    );
    let status = b.call("identity.status", json!({})).await;
    assert_eq!(
        (status["did"].as_str(), status["keyId"].as_str()),
        (Some(did.as_str()), Some("d2"))
    );

    // Bound to A's identity, B refuses an offer of another one: its key speaks for an identity.
    let refused = b
        .try_call(
            "identity.claimOffer",
            json!({ "offer": other_offer, "canKeepMaster": false }),
        )
        .await
        .expect_err("a linked desktop executor claimed an offer of a second identity");
    assert!(refused.contains("already-linked"), "{refused}");
    assert_eq!(log_ops(&c, &other_did).await, ["incept"]);

    // Once the holder revokes d2, B's key speaks for no identity, but the operator it recorded
    // at the join stays: an offer of another identity is now refused `first-link`.
    let confirm = holder
        .start(IdentityStep::Revoke {
            key_id: "d2".into(),
        })
        .await
        .unwrap();
    assert!(
        matches!(&confirm, Screen::RevokeConfirm { key_id, .. } if key_id == "d2"),
        "{confirm:?}"
    );
    let revoked = holder
        .step(StepInput::Revoke {
            rotate: false,
            passphrase: Some(PASSPHRASE.into()),
        })
        .await
        .unwrap();
    assert!(
        matches!(&revoked, Screen::Revoked { key_id, seq: 2 } if key_id == "d2"),
        "{revoked:?}"
    );
    let status = b.call("identity.status", json!({})).await;
    assert_eq!(status["revoked"], 2, "B reports its key revoked: {status}");
    let refused = b
        .try_call(
            "identity.claimOffer",
            json!({ "offer": other_offer, "canKeepMaster": false }),
        )
        .await
        .expect_err("a desktop executor claimed an offer of an identity not its operator");
    assert!(refused.contains("first-link"), "{refused}");
    assert!(
        refused.contains(&did) && refused.contains(&other_did),
        "the refusal names the operator and the offer's identity: {refused}"
    );
    // C's identity never got B's key.
    assert_eq!(log_ops(&c, &other_did).await, ["incept"]);
}

/// `method` as the bot, on a socket of its own session `token`, with `reason` as the frame's
/// `meta.reason`: the answer, or the error (or the close) as the executor said it.
async fn as_bot(
    node: &Node,
    token: &str,
    method: &str,
    params: Value,
    reason: Option<&str>,
) -> Result<Value, String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    let token: String = token
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect();
    let url = format!("ws://127.0.0.1:{}/api/v1/ws?token={token}", node.port);
    let (mut socket, _) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(|e| format!("connect: {e}"))?;
    let mut frame = json!({ "id": "bot-1", "type": method, "params": params });
    if let Some(reason) = reason {
        frame["meta"] = json!({ "reason": reason });
    }
    socket
        .send(Message::Text(frame.to_string()))
        .await
        .map_err(|e| format!("send: {e}"))?;
    let answer = tokio::time::timeout(Duration::from_secs(120), async {
        while let Some(message) = socket.next().await {
            match message {
                Ok(Message::Text(text)) => {
                    let parsed: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                    if parsed["id"] != "bot-1" {
                        continue;
                    }
                    return match parsed.get("error").filter(|e| !e.is_null()) {
                        Some(error) => Err(error.to_string()),
                        None => Ok(parsed["result"].clone()),
                    };
                }
                Ok(Message::Close(frame)) => return Err(format!("closed: {frame:?}")),
                Ok(_) => continue,
                Err(e) => return Err(format!("read: {e}")),
            }
        }
        Err("closed without an answer".to_string())
    })
    .await
    .map_err(|_| format!("{method}: no answer"))?;
    let _ = socket.close(None).await;
    answer
}

/// A neighbourhood `node`'s agent makes and publishes on the diff-sync link language: its URL.
async fn publish_space(world: &World, node: &Node, name: &str) -> String {
    let diff_sync = std::fs::read_to_string(
        world
            .repo
            .join("tests/js/scripts/perspective-diff-sync-hash"),
    )
    .expect("run `pnpm run prepare-test-local` in <ad4m>/tests/js first");
    let perspective = node
        .call("perspective.create", json!({ "name": name }))
        .await;
    // A language of its own: the uid is the temp folder's, unique to this run.
    let run = world.dir.file_name().unwrap().to_string_lossy();
    let template = json!({ "uid": format!("{name}-{run}"), "name": name });
    let language = node
        .call(
            "language.applyTemplate",
            json!({
                "sourceLanguageHash": diff_sync.trim(),
                "templateData": template.to_string(),
            }),
        )
        .await;
    let url = node
        .call(
            "neighbourhood.publish",
            json!({
                "perspectiveUuid": perspective["uuid"],
                "linkLanguage": language["address"],
                "meta": { "links": [] },
            }),
        )
        .await;
    url.as_str().expect("a neighbourhood URL").to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn add_a_bot_grant_it_one_space_pause_it_and_revoke_it() {
    let Some((_one, world)) = set_up().await else {
        return;
    };

    // A: the computer that keeps the master key. B: a desktop executor, where the bot runs.
    let a_admin = "custody-live-a-admin";
    let a = world.start_node("a", None, Some(a_admin), None).await;
    let holder = custody_on(a.url(), a_admin, &world.dir.join("custody-a"));
    let did = make_identity(&holder).await;
    let (b_admin, b_custody) = ("custody-live-b-admin", "custody-live-b-custody");
    let b = world
        .start_node("b", None, Some(b_admin), Some(b_custody))
        .await;

    // The holder chooses what the bot's key may ever do, unlocks, and gets the offer.
    let mut shown = Shown::default();
    let scope = shown.record(&holder.start(IdentityStep::AddBot).await.unwrap());
    assert!(
        matches!(scope, Screen::BotScope { error: None }),
        "{scope:?}"
    );
    let unlock = holder
        .step(StepInput::BotScope {
            can: vec!["read".into(), "write".into(), "join".into()],
            days: 30,
        })
        .await
        .unwrap();
    assert!(
        matches!(unlock, Screen::EnterPassphrase { error: None }),
        "{unlock:?}"
    );
    let offered = shown.record(
        &holder
            .step(StepInput::Passphrase {
                passphrase: PASSPHRASE.into(),
                confirm: None,
            })
            .await
            .unwrap(),
    );
    let Screen::BotOffer {
        offer,
        can,
        key_expires,
        ..
    } = offered
    else {
        panic!("no bot offer: {offered:?}")
    };
    assert_eq!(can, ["read", "write", "join"]);

    // B makes the bot agent from the offer; the holder sees B's claim with the same match code.
    let waiting = tokio::spawn({
        let holder = holder.clone();
        async move { holder.step(StepInput::WaitClaim).await }
    });
    let created = b
        .call(
            "bot.createAgent",
            json!({ "offer": offer, "name": "Test bot" }),
        )
        .await;
    let bot = created["did"].as_str().unwrap().to_string();
    let token = created["token"].as_str().unwrap().to_string();
    assert!(!token.is_empty());
    let matched = shown.record(&waiting.await.unwrap().unwrap());
    let Screen::BotMatch { code, name } = matched else {
        panic!("no bot match: {matched:?}")
    };
    assert_eq!(code, created["matchCode"].as_str().unwrap());
    assert_eq!(name.as_deref(), Some("Test bot"));
    let added = shown.record(
        &holder
            .step(StepInput::Confirm {
                name: None,
                keep_master: false,
                this_name: None,
            })
            .await
            .unwrap(),
    );
    assert!(
        matches!(&added, Screen::BotAdded { key_id, name, .. } if key_id == "d2" && name == "Test bot"),
        "{added:?}"
    );
    // Nothing the identity window showed carried the bot's session token.
    assert!(shown.0.iter().all(|s| !s.contains(&token)));

    // The bot's key is in the owner's log with its scope, and its grant is empty at version 1.
    let view = b.call("bot.grant", json!({ "bot": bot })).await;
    assert_eq!(view["owner"], json!(did));
    assert_eq!(view["grant"]["version"], 1, "{view}");
    assert_eq!(view["grant"]["spaces"], json!([]));
    assert_eq!(view["key"]["keyId"], "d2", "{view}");
    assert_eq!(view["key"]["verdict"], "valid", "{view}");
    assert_eq!(view["key"]["expires"], json!(key_expires));

    // Two spaces of the owner's; the grant names one, to read and write and join.
    let garden = publish_space(&world, &b, "garden").await;
    let other = publish_space(&world, &b, "other").await;
    let granted = b
        .call(
            "bot.setGrant",
            json!({
                "bot": bot, "spaces": [garden], "can": ["read", "write", "join"],
                "state": "active", "version": 1,
            }),
        )
        .await;
    assert_eq!(granted["grant"]["version"], 2, "{granted}");
    // A grant saved over a version that is gone answers the conflict, and changes nothing.
    let stale = b
        .try_call(
            "bot.setGrant",
            json!({
                "bot": bot, "spaces": [], "can": ["read"], "state": "active", "version": 1,
            }),
        )
        .await
        .expect_err("a grant saved over an old version");
    assert!(
        stale.contains("409") && stale.contains("version"),
        "{stale}"
    );

    // The bot joins and writes in its space with its reasons; the other space refuses it.
    let joined = as_bot(
        &b,
        &token,
        "neighbourhood.join",
        json!({ "url": garden }),
        Some("tend the garden board"),
    )
    .await
    .unwrap();
    let space = joined["uuid"].as_str().unwrap().to_string();
    let link = json!({
        "source": "ad4m://self", "predicate": "test://note", "target": "literal://string:sown",
    });
    as_bot(
        &b,
        &token,
        "perspective.addLink",
        json!({ "uuid": space, "link": link, "status": "shared" }),
        Some("log the first sowing"),
    )
    .await
    .unwrap();
    let refused = as_bot(
        &b,
        &token,
        "neighbourhood.join",
        json!({ "url": other }),
        Some("look around"),
    )
    .await
    .expect_err("the bot joined a space not in its grant");
    assert!(refused.contains("bot-grant"), "{refused}");

    // Paused, it is refused in its own space too.
    let paused = b
        .call(
            "bot.setGrant",
            json!({
                "bot": bot, "spaces": [garden], "can": ["read", "write", "join"],
                "state": "paused", "version": 2,
            }),
        )
        .await;
    assert_eq!(paused["grant"]["state"], "paused", "{paused}");
    let refused = as_bot(
        &b,
        &token,
        "perspective.addLink",
        json!({ "uuid": space, "link": link, "status": "shared" }),
        Some("one more"),
    )
    .await
    .expect_err("a paused bot wrote");
    assert!(refused.contains("bot-paused"), "{refused}");

    // Revoked, it is refused, and the grant never changes again.
    let revoked = b
        .call(
            "bot.setGrant",
            json!({
                "bot": bot, "spaces": [garden], "can": ["read", "write", "join"],
                "state": "revoked", "version": 3,
            }),
        )
        .await;
    assert_eq!(revoked["grant"]["state"], "revoked", "{revoked}");
    let refused = as_bot(
        &b,
        &token,
        "perspective.queryLinks",
        json!({ "uuid": space, "query": {} }),
        None,
    )
    .await
    .expect_err("a revoked bot read");
    assert!(
        ["bot-revoked", "revoked", "Unauthorized"]
            .iter()
            .any(|code| refused.contains(code)),
        "{refused}"
    );
    let again = b
        .try_call(
            "bot.setGrant",
            json!({
                "bot": bot, "spaces": [garden], "can": ["read"], "state": "active", "version": 4,
            }),
        )
        .await
        .expect_err("a revoked bot resumed");
    assert!(again.contains("bot-revoked"), "{again}");

    // Its activity log, newest first: the allowed calls with their reasons, and each refusal.
    let log = b.call("bot.log", json!({ "bot": bot })).await;
    let entries = log.as_array().unwrap();
    let ats: Vec<i64> = entries.iter().map(|e| e["at"].as_i64().unwrap()).collect();
    let mut newest_first = ats.clone();
    newest_first.sort_by(|x, y| y.cmp(x));
    assert_eq!(ats, newest_first, "{log}");
    let allowed: Vec<(&str, &str)> = entries
        .iter()
        .filter(|e| e["outcome"] == "allowed")
        .map(|e| {
            (
                e["method"].as_str().unwrap(),
                e["reason"].as_str().unwrap_or(""),
            )
        })
        .collect();
    assert!(
        allowed.contains(&("neighbourhood.join", "tend the garden board")),
        "{log}"
    );
    assert!(
        allowed.contains(&("perspective.addLink", "log the first sowing")),
        "{log}"
    );
    let outcomes: Vec<&str> = entries
        .iter()
        .map(|e| e["outcome"].as_str().unwrap())
        .collect();
    for code in ["bot-grant", "bot-paused"] {
        assert!(outcomes.contains(&code), "{code} not logged: {log}");
    }
    // Paged by `before`: the entries older than the newest one.
    let newest = entries[0]["id"].as_i64().unwrap();
    let older = b
        .call(
            "bot.log",
            json!({ "bot": bot, "before": newest, "limit": 1 }),
        )
        .await;
    let older = older.as_array().unwrap();
    assert_eq!(older.len(), 1);
    assert!(older[0]["id"].as_i64().unwrap() < newest);
}

/// The ops of `did`'s log, fresh from the store, as `node` reads it.
async fn log_ops(node: &Node, did: &str) -> Vec<String> {
    let log = node
        .call(
            "identity.log",
            json!({ "did": did, "from": 0, "fresh": true }),
        )
        .await;
    log["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["op"].as_str().unwrap().to_string())
        .collect()
}
