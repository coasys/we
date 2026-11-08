//! The phone against a real identity store, its router in process: the phone's `DeviceKeys`
//! and `PhoneIdentity` over a blocking transport, a computer (`ViaStore` with its master key in
//! a `MemoryVault`) on the other side.
//!
//! The phone's calls block, as they do on Android's background thread; the computer's flows run
//! on the test's runtime between them.

use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use ad4m_identity_client::flows::create::{CreateFlow, CreateScreen};
use ad4m_identity_client::flows::link::LinkFlow;
use ad4m_identity_client::flows::master::take_master;
use ad4m_identity_client::flows::requests::{answer, ask_for_master};
use ad4m_identity_client::record;
use ad4m_identity_client::{
    ExecutorRpc, HttpClient, HttpError, HttpRequest, HttpResponse, MemoryVault, OsRandom,
    SoftEncKey, StoreEndpoint, SystemClock, Vault, ViaExecutor, ViaStore,
};
use ad4m_identity_core::link::OfferKind;
use ad4m_identity_core::record::{DeviceEntry, DeviceKind, HoldsMaster};
use ad4m_identity_core::words;
use async_trait::async_trait;
use axum::body::Body;
use axum::http::Request;
use axum::Router;
use ed25519_dalek::SigningKey;
use http_body_util::BodyExt;
use identity_store::db::Db;
use identity_store::{router, system_clock, Settings, Store, StoreKey};
use serde_json::{json, Value};
use tokio::runtime::Runtime;
use tower::ServiceExt;
use we_phone_custody::{
    ClaimProgress, DeviceKeys, Header, LinkStep, MasterSealError, MasterSealer, PhoneIdentity,
    PhoneKeyError, SealError, Sealer, StoreConfig, StoreReply, StoreRequest, StoreTransport,
    TransportError,
};

const STORE_URL: &str = "http://store.test";
const STORE_SECRET: [u8; 32] = [7; 32];

// ─── the store ──────────────────────────────────────────────────────────────────────────

struct World {
    rt: Arc<Runtime>,
    router: Router,
    _dir: tempfile::TempDir,
}

fn world() -> World {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("store.sqlite")).unwrap();
    let store = Store::new(
        db,
        StoreKey::from_secret(STORE_SECRET),
        system_clock(),
        Settings {
            pow_bits: 8,
            identity_burst: 100,
            ..Settings::default()
        },
    );
    World {
        rt: Arc::new(
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .unwrap(),
        ),
        router: router(store),
        _dir: dir,
    }
}

impl World {
    /// Runs a computer's step to its end.
    fn on<F: Future>(&self, future: F) -> F::Output {
        self.rt.block_on(future)
    }
}

fn store_keys() -> Vec<String> {
    let did = StoreKey::from_secret(STORE_SECRET).did();
    vec![did.strip_prefix("did:key:").unwrap().to_string()]
}

async fn route(router: &Router, request: HttpRequest) -> Result<HttpResponse, HttpError> {
    let mut builder = Request::builder()
        .method(request.method.as_str())
        .uri(request.url.as_str());
    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }
    let response = router
        .clone()
        .oneshot(builder.body(Body::from(request.body)).unwrap())
        .await
        .map_err(|e| HttpError(e.to_string()))?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
        .collect();
    let body = response
        .into_body()
        .collect()
        .await
        .map_err(|e| HttpError(e.to_string()))?
        .to_bytes()
        .to_vec();
    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}

/// The computer's `HttpClient`.
struct RouterHttp(Router);

#[async_trait(?Send)]
impl HttpClient for RouterHttp {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        route(&self.0, request).await
    }
}

/// The phone's transport: blocking, as the app's is. `offline` answers no request.
struct PhoneHttp {
    rt: Arc<Runtime>,
    router: Router,
    offline: AtomicBool,
    sent: AtomicUsize,
}

impl StoreTransport for PhoneHttp {
    fn send(&self, request: StoreRequest) -> Result<StoreReply, TransportError> {
        if self.offline.load(Ordering::SeqCst) {
            return Err(TransportError::Failed {
                reason: "Unable to resolve host \"store.test\"".into(),
            });
        }
        self.sent.fetch_add(1, Ordering::SeqCst);
        let request = HttpRequest {
            method: request.method,
            url: request.url,
            headers: request
                .headers
                .into_iter()
                .map(|h| (h.name, h.value))
                .collect(),
            body: request.body,
        };
        let reply = self
            .rt
            .block_on(route(&self.router, request))
            .map_err(|e| TransportError::Failed { reason: e.0 })?;
        Ok(StoreReply {
            status: reply.status,
            headers: reply
                .headers
                .into_iter()
                .map(|(name, value)| Header { name, value })
                .collect(),
            body: reply.body,
        })
    }
}

// ─── the phone's key stores ─────────────────────────────────────────────────────────────

/// The device-key sealer (no user auth): the label, then the bytes XORed. `refuse_enc` answers
/// an open of the enc seed as a Keystore that errors (the device key still opens, so the phone
/// reaches the store and the error is the inbox message's).
#[derive(Default)]
struct DeviceSealer {
    refuse_enc: AtomicBool,
}

impl Sealer for DeviceSealer {
    fn seal(&self, label: String, plaintext: Vec<u8>) -> Result<Vec<u8>, SealError> {
        let mut out = label.into_bytes();
        out.push(0);
        out.extend(plaintext.iter().map(|b| b ^ 0x5a));
        Ok(out)
    }
    fn open(&self, label: String, sealed: Vec<u8>) -> Result<Vec<u8>, SealError> {
        if self.refuse_enc.load(Ordering::SeqCst) && label == we_phone_custody::ENC_LABEL {
            return Err(SealError::Failed {
                reason: "android.security.KeyStoreException: system error".into(),
            });
        }
        let mut prefix = label.into_bytes();
        prefix.push(0);
        let body = sealed
            .strip_prefix(prefix.as_slice())
            .ok_or_else(|| SealError::Failed {
                reason: "sealed under another label".into(),
            })?;
        Ok(body.iter().map(|b| b ^ 0x5a).collect())
    }
    fn wipe(&self) {}
}

/// What the master sealer does at its next prompt.
#[derive(Clone, Copy, PartialEq)]
enum Finger {
    Touch,
    Cancel,
    Invalidated,
}

/// The master-key sealer: a biometric prompt per use, counted with the sentence it showed.
struct MasterKeystore {
    protection: Mutex<String>,
    finger: Mutex<Finger>,
    prompts: Mutex<Vec<String>>,
    opened: Mutex<Vec<String>>,
}

impl MasterKeystore {
    fn new(protection: &str) -> Arc<Self> {
        Arc::new(MasterKeystore {
            protection: Mutex::new(protection.into()),
            finger: Mutex::new(Finger::Touch),
            prompts: Mutex::new(Vec::new()),
            opened: Mutex::new(Vec::new()),
        })
    }
    fn prompts(&self) -> Vec<String> {
        self.prompts.lock().unwrap().clone()
    }
    fn next(&self, finger: Finger) {
        *self.finger.lock().unwrap() = finger;
    }
    fn prompt(&self, prompt: String) -> Result<(), MasterSealError> {
        self.prompts.lock().unwrap().push(prompt);
        match *self.finger.lock().unwrap() {
            Finger::Touch => Ok(()),
            Finger::Cancel => Err(MasterSealError::Cancelled),
            Finger::Invalidated => Err(MasterSealError::Invalidated),
        }
    }
}

impl MasterSealer for MasterKeystore {
    fn protection(&self) -> String {
        self.protection.lock().unwrap().clone()
    }
    fn seal(
        &self,
        label: String,
        plaintext: Vec<u8>,
        prompt: String,
    ) -> Result<Vec<u8>, MasterSealError> {
        self.prompt(prompt)?;
        let mut out = label.into_bytes();
        out.push(0);
        out.extend(plaintext.iter().map(|b| b ^ 0xa5));
        Ok(out)
    }
    fn open(
        &self,
        label: String,
        sealed: Vec<u8>,
        prompt: String,
    ) -> Result<Vec<u8>, MasterSealError> {
        self.prompt(prompt)?;
        let mut prefix = label.clone().into_bytes();
        prefix.push(0);
        let body =
            sealed
                .strip_prefix(prefix.as_slice())
                .ok_or_else(|| MasterSealError::Failed {
                    reason: "sealed under another label".into(),
                })?;
        self.opened.lock().unwrap().push(label);
        Ok(body.iter().map(|b| b ^ 0xa5).collect())
    }
    fn wipe(&self) {}
}

// ─── the phone ──────────────────────────────────────────────────────────────────────────

struct Phone {
    dir: tempfile::TempDir,
    keys: Arc<DeviceKeys>,
    sealer: Arc<DeviceSealer>,
    http: Arc<PhoneHttp>,
    master: Arc<MasterKeystore>,
    identity: Arc<PhoneIdentity>,
}

fn phone(world: &World, protection: &str) -> Phone {
    let dir = tempfile::tempdir().unwrap();
    let sealer = Arc::new(DeviceSealer::default());
    let keys = DeviceKeys::open(dir.path().to_string_lossy().into(), sealer.clone()).unwrap();
    keys.create().unwrap();
    let http = Arc::new(PhoneHttp {
        rt: world.rt.clone(),
        router: world.router.clone(),
        offline: AtomicBool::new(false),
        sent: AtomicUsize::new(0),
    });
    let master = MasterKeystore::new(protection);
    let identity = open_identity(&keys, &http, &master);
    Phone {
        dir,
        keys,
        sealer,
        http,
        master,
        identity,
    }
}

fn open_identity(
    keys: &Arc<DeviceKeys>,
    http: &Arc<PhoneHttp>,
    master: &Arc<MasterKeystore>,
) -> Arc<PhoneIdentity> {
    PhoneIdentity::new(
        keys.clone(),
        http.clone(),
        master.clone(),
        StoreConfig {
            url: STORE_URL.into(),
            keys: store_keys(),
        },
    )
    .unwrap()
}

impl Phone {
    /// The phone's 2a join: the claim posted, then its state read once the holder confirmed.
    fn claim(&self, offer_link: &str) -> we_phone_custody::PreparedClaim {
        let prepared = self
            .keys
            .prepare_claim(offer_link.into(), Some("Pixel 8".into()))
            .unwrap();
        let reply = self.post(&prepared.claim_url, prepared.body.as_bytes().to_vec());
        let progress = self
            .keys
            .claim_answer(reply.status, String::from_utf8(reply.body).unwrap())
            .unwrap();
        assert!(
            matches!(progress, ClaimProgress::Waiting { .. }),
            "{progress:?}"
        );
        prepared
    }

    fn joined(&self, prepared: &we_phone_custody::PreparedClaim) {
        let reply = self.get(&prepared.state_url);
        let progress = self
            .keys
            .claim_answer(reply.status, String::from_utf8(reply.body).unwrap())
            .unwrap();
        assert!(
            matches!(progress, ClaimProgress::Joined { .. }),
            "{progress:?}"
        );
    }

    fn post(&self, url: &str, body: Vec<u8>) -> StoreReply {
        self.http
            .send(StoreRequest {
                method: "POST".into(),
                url: url.into(),
                headers: vec![Header {
                    name: "content-type".into(),
                    value: "application/json".into(),
                }],
                body,
            })
            .unwrap()
    }

    fn get(&self, url: &str) -> StoreReply {
        self.http
            .send(StoreRequest {
                method: "GET".into(),
                url: url.into(),
                headers: Vec::new(),
                body: Vec::new(),
            })
            .unwrap()
    }
}

// ─── the computer ───────────────────────────────────────────────────────────────────────

struct Computer {
    exec: ViaExecutor<ViaStore>,
    vault: MemoryVault,
}

fn computer(world: &World, seed: u8) -> Computer {
    let key = SigningKey::from_bytes(&[seed; 32]);
    let enc = SoftEncKey::from_ed25519(&key);
    Computer {
        exec: ViaExecutor::new(ViaStore::new(
            Box::new(RouterHttp(world.router.clone())),
            Box::new(key),
            Box::new(enc),
            Box::new(SystemClock),
            Box::new(OsRandom),
            StoreEndpoint {
                url: STORE_URL.into(),
                keys: store_keys(),
            },
            None,
        )),
        vault: MemoryVault::new(),
    }
}

fn entry(name: &str, kind: DeviceKind) -> DeviceEntry {
    DeviceEntry {
        name: name.into(),
        kind,
        place: None,
        address: None,
        runs_executor: false,
        holds_master: HoldsMaster::No,
        master_index: None,
        operator: None,
    }
}

/// A new identity on `computer`, its master #0 in the computer's vault.
fn create(world: &World, computer: &Computer, entropy: u8) -> String {
    let (mut flow, screen) = CreateFlow::from_words(words::from_entropy(&[entropy; 16]));
    let CreateScreen::ShowWords(secret) = screen else {
        panic!("expected the words");
    };
    let list = secret.expose().clone();
    let CreateScreen::ConfirmWords { positions } = flow.words_written(&OsRandom).unwrap() else {
        panic!("expected the confirm screen");
    };
    flow.confirm([&list[positions[0] - 1], &list[positions[1] - 1]])
        .unwrap();
    world
        .on(flow.finish(
            &computer.exec,
            &computer.vault,
            entry("Laptop", DeviceKind::DesktopApp),
            &OsRandom,
        ))
        .unwrap()
        .did
}

fn scid(did: &str) -> String {
    ad4m_identity_core::scid_of(did).unwrap().to_string()
}

/// The phone joins `did` through the computer's offer, scanned; with `keep` the computer sends
/// it the master key.
fn join(world: &World, computer: &Computer, phone: &Phone, did: &str, keep: bool) {
    let flow = world
        .on(LinkFlow::open(
            &computer.exec,
            &computer.vault,
            did,
            OfferKind::Device,
            None,
            STORE_URL,
            &SystemClock,
            &OsRandom,
        ))
        .unwrap();
    let prepared = phone.claim(&flow.link());
    let claimed = world.on(flow.wait_for_claim()).unwrap();
    assert_eq!(claimed.match_code, prepared.match_code);
    assert!(
        claimed.can_keep_master,
        "the phone's claim offers to keep the master key"
    );
    assert!(flow.may_keep(&claimed));
    world
        .on(flow.confirm(&claimed, entry("Pixel 8", DeviceKind::PhoneApp), keep))
        .unwrap();
    phone.joined(&prepared);
}

// ─── the tests ──────────────────────────────────────────────────────────────────────────

// The phone joins by the computer's offer, the computer sends it the master key, and the phone
// takes it: one prompt to seal it, kept under its identity and index, the inbox message
// acknowledged, and the record saying the phone holds master #0.
#[test]
fn the_phone_takes_the_master_key_the_computer_sent_it() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 42);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, true);

    let status = phone.identity.status().unwrap();
    assert_eq!(status.did, did);
    assert_eq!(status.key_id.as_deref(), Some("d2"));
    assert_eq!(status.master_index, None);
    assert_eq!(status.protection, "strongbox");

    let taken = phone
        .identity
        .take_master(false)
        .unwrap()
        .expect("a master key waits");
    assert_eq!(taken.did, did);
    assert_eq!(taken.index, 0);
    assert_eq!(taken.note, None);
    assert_eq!(
        phone.master.prompts(),
        vec!["Keep your master key on this phone"]
    );
    assert_eq!(phone.identity.status().unwrap().master_index, Some(0));

    // Nothing waits any more: the message was acknowledged.
    assert_eq!(phone.identity.take_master(false).unwrap(), None);

    // The record, as the computer reads it, says the phone holds master #0.
    let opened = world.on(record::read(&laptop.exec, &did)).unwrap().unwrap();
    assert_eq!(opened.record.devices["d2"].holds_master, HoldsMaster::Yes);
    assert_eq!(opened.record.devices["d2"].master_index, Some(0));

    // The key file says where the phone joined; the vault file is beside it and holds no seed
    // in the clear.
    let file = std::fs::read_to_string(phone.dir.path().join("master-keys.json")).unwrap();
    let kept: Value = serde_json::from_str(&file).unwrap();
    assert_eq!(kept["kept"][0]["scid"], json!(scid(&did)));
    assert_eq!(kept["kept"][0]["index"], json!(0));
    let keys = std::fs::read_to_string(phone.dir.path().join("device-keys.json")).unwrap();
    assert!(keys.contains("\"store\": \"http://store.test\""), "{keys}");

    // A phone that restarts reads the vault again and names the key without a prompt.
    let reopened = open_identity(&phone.keys, &phone.http, &phone.master);
    assert_eq!(reopened.status().unwrap().master_index, Some(0));
    assert_eq!(phone.master.prompts().len(), 1);
}

// A Keystore without secure hardware (an emulator's) keeps no master key until the person
// agrees: the refusal comes before any prompt and leaves the message in the inbox.
#[test]
fn a_software_keystore_keeps_the_master_key_only_once_the_person_agrees() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 43);
    let phone = phone(&world, "software");
    join(&world, &laptop, &phone, &did, true);

    match phone.identity.take_master(false) {
        Err(PhoneKeyError::WeakProtection { protection }) => assert_eq!(protection, "software"),
        other => panic!("expected WeakProtection, got {other:?}"),
    }
    assert!(
        phone.master.prompts().is_empty(),
        "no prompt before the person agrees"
    );
    assert_eq!(phone.identity.status().unwrap().master_index, None);

    let taken = phone
        .identity
        .take_master(true)
        .unwrap()
        .expect("the message stayed");
    assert_eq!(taken.index, 0);
    assert_eq!(phone.master.prompts().len(), 1);
}

// A prompt the person closes, or a Keystore that errors, takes nothing: the master key waits in
// the inbox for the next try.
#[test]
fn a_cancelled_prompt_or_a_keystore_error_leaves_the_master_key_waiting() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 44);
    let phone = phone(&world, "tee");
    join(&world, &laptop, &phone, &did, true);

    phone.master.next(Finger::Cancel);
    assert!(matches!(
        phone.identity.take_master(false),
        Err(PhoneKeyError::Cancelled)
    ));

    // The enc key's Keystore errors: the inbox message does not open, and stays.
    phone.master.next(Finger::Touch);
    phone.sealer.refuse_enc.store(true, Ordering::SeqCst);
    let refused = phone.identity.take_master(false);
    assert!(
        matches!(refused, Err(PhoneKeyError::Unavailable { .. })),
        "{refused:?}"
    );
    phone.sealer.refuse_enc.store(false, Ordering::SeqCst);

    let taken = phone
        .identity
        .take_master(false)
        .unwrap()
        .expect("still waiting");
    assert_eq!(taken.index, 0);
}

// A phone without the master key asks for it; the computer sees the request, answers it, and
// the phone takes the key from its inbox.
#[test]
fn the_phone_asks_for_the_master_key_and_the_computer_answers() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 45);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, false);
    assert_eq!(phone.identity.take_master(false).unwrap(), None);

    let asked = phone.identity.ask_for_master().unwrap();
    assert_eq!(asked.key_id, "d2");
    assert_eq!(asked.code.len(), 7, "{}", asked.code);

    let requests = world.on(laptop.exec.requests(0)).unwrap();
    let request = requests.iter().find(|r| r.id == asked.request_id).unwrap();
    assert_eq!(request.by, "d2");
    world
        .on(answer(
            &laptop.exec,
            &laptop.vault,
            &did,
            request,
            &SystemClock,
            &OsRandom,
        ))
        .unwrap();

    let taken = phone
        .identity
        .take_master(false)
        .unwrap()
        .expect("the answer");
    assert_eq!(taken.index, 0);
}

// The phone holds the master key and answers another device's `send-master` behind its prompt;
// a biometric enrolled since invalidates the key, which the phone says rather than retrying.
#[test]
fn the_phone_answers_a_request_behind_the_prompt() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 46);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, true);
    phone.identity.take_master(false).unwrap().unwrap();

    // The laptop forgets its key and asks for one.
    laptop.vault.forget_master(&scid(&did)).unwrap();
    let id = world.on(ask_for_master(&laptop.exec, None)).unwrap();

    let listed = phone.identity.requests().unwrap();
    assert_eq!(listed.len(), 1, "{listed:?}");
    let request = &listed[0];
    assert_eq!(request.id, id);
    assert_eq!(request.kind, "send-master");
    assert_eq!(request.by, "d1");
    assert_eq!(request.device, "Laptop");
    assert_eq!(request.problem, None);
    let laptop_sign = ad4m_identity_core::build::Signer::key(&SigningKey::from_bytes(&[1; 32]));
    assert_eq!(
        request.code,
        ad4m_identity_core::link::match_code(&scid(&did), &id, &laptop_sign)
    );

    phone.master.next(Finger::Invalidated);
    assert!(matches!(
        phone.identity.answer(id.clone()),
        Err(PhoneKeyError::KeyInvalidated)
    ));
    phone.master.next(Finger::Touch);

    let answered = phone.identity.answer(id).unwrap();
    assert_eq!(answered.kind, "send-master");
    assert_eq!(answered.device, "Laptop");
    assert_eq!(
        phone.master.prompts().last().map(String::as_str),
        Some("Send your master key to your device")
    );

    let taken = world
        .on(take_master(&laptop.exec, &laptop.vault, &OsRandom))
        .unwrap()
        .expect("the phone's answer");
    assert_eq!(taken.index, 0);
}

// The phone scans a new computer's device code: the ticket lands in the computer's pre-join
// inbox, the computer claims it, both show the same code, and the phone adds it and sends it the
// master key.
#[test]
fn the_phone_adds_a_device_by_its_code() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 47);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, true);
    phone.identity.take_master(false).unwrap().unwrap();

    let desktop = computer(&world, 5);
    let prepared = world
        .on(desktop.exec.rpc().call("identity.prepareDevice", json!({})))
        .unwrap();
    let code = prepared["device"].as_str().unwrap().to_string();
    assert!(code.starts_with("coasys:device:1:"));

    let link = phone.identity.scan_device(code).unwrap();
    assert!(matches!(link.next().unwrap(), LinkStep::TicketSent { .. }));

    let inbox = world
        .on(desktop.exec.rpc().call("identity.inbox", json!({})))
        .unwrap();
    let ticket = &inbox.as_array().unwrap()[0];
    assert_eq!(ticket["kind"], json!("offer-ticket"));

    let LinkStep::Claimed {
        code,
        can_keep_master,
        ..
    } = link.next().unwrap()
    else {
        panic!("expected the claim");
    };
    assert_eq!(code, ticket["matchCode"].as_str().unwrap());
    assert!(can_keep_master);

    link.confirm(Some("Desktop".into()), true).unwrap();
    let LinkStep::Linked {
        key_id,
        master_sent,
        note,
        ..
    } = link.next().unwrap()
    else {
        panic!("expected the link");
    };
    assert_eq!(key_id, "d3");
    assert!(master_sent);
    assert_eq!(note, None);
    assert!(matches!(link.next(), Err(PhoneKeyError::Ended { .. })));

    let taken = world
        .on(take_master(&desktop.exec, &desktop.vault, &OsRandom))
        .unwrap()
        .expect("the phone sent the master key");
    assert_eq!(taken.did, did);

    // The devices, from the log and the record.
    let devices = phone.identity.devices().unwrap();
    let names: Vec<_> = devices
        .iter()
        .map(|d| (d.key_id.as_str(), d.name.as_str()))
        .collect();
    assert_eq!(
        names,
        vec![("d1", "Laptop"), ("d2", "Pixel 8"), ("d3", "Desktop")]
    );
    let me = devices.iter().find(|d| d.this_device).unwrap();
    assert_eq!(me.key_id, "d2");
    assert_eq!(me.holds_master, "yes");
    assert_eq!(me.master_index, Some(0));
    assert!(me.may_keep_master);
}

// A link the person cancels while it waits for the claim stops at its next request.
#[test]
fn a_cancelled_link_ends() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 48);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, true);
    phone.identity.take_master(false).unwrap().unwrap();

    let desktop = computer(&world, 6);
    let prepared = world
        .on(desktop.exec.rpc().call("identity.prepareDevice", json!({})))
        .unwrap();
    let link = phone
        .identity
        .scan_device(prepared["device"].as_str().unwrap().into())
        .unwrap();
    assert!(matches!(link.next().unwrap(), LinkStep::TicketSent { .. }));
    link.cancel();
    assert!(matches!(link.next(), Err(PhoneKeyError::Cancelled)));
    assert!(matches!(
        link.confirm(None, false),
        Err(PhoneKeyError::Ended { .. })
    ));
}

// Devices are renamed in the record; a phone that cannot reach the store says so as
// `Unavailable`, never as a refusal.
#[test]
fn rename_and_offline() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 49);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, false);

    phone
        .identity
        .rename("d1".into(), "Work laptop".into())
        .unwrap();
    let devices = phone.identity.devices().unwrap();
    assert_eq!(devices[0].name, "Work laptop");
    assert_eq!(devices[1].holds_master, "no");
    assert!(matches!(
        phone.identity.rename("d1".into(), "  ".into()),
        Err(PhoneKeyError::Invalid { .. })
    ));

    phone.http.offline.store(true, Ordering::SeqCst);
    let offline = phone.identity.status();
    assert!(
        matches!(offline, Err(PhoneKeyError::Unavailable { .. })),
        "{offline:?}"
    );
    assert!(matches!(
        phone.identity.take_master(false),
        Err(PhoneKeyError::Unavailable { .. })
    ));
    assert!(phone.http.sent.load(Ordering::SeqCst) > 0);
}

// The head a log was admitted at is kept in `log-checkpoints.json` beside the key file, so a
// restarted phone still refuses a store whose log is behind it.
#[test]
fn a_restarted_phone_refuses_a_log_behind_the_one_it_admitted() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 51);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, false);
    phone.identity.status().unwrap();

    let path = phone.dir.path().join("log-checkpoints.json");
    let mut kept: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let head = kept["logs"][scid(&did)].clone();
    let seq = head["seq"].as_u64().expect("the admitted head's seq");
    assert!(seq >= 1, "{head}");
    assert!(
        head["hash"].as_str().is_some_and(|h| !h.is_empty()),
        "{head}"
    );

    // A restart over the same file reads the log the same: nothing is refused.
    let reopened = open_identity(&phone.keys, &phone.http, &phone.master);
    reopened.status().unwrap();

    // The phone had admitted a later head than the store now serves: the store is behind.
    kept["logs"][scid(&did)] = json!({ "seq": seq + 3, "hash": "a later head" });
    std::fs::write(&path, serde_json::to_vec(&kept).unwrap()).unwrap();
    let restarted = open_identity(&phone.keys, &phone.http, &phone.master);
    let behind = restarted.status();
    assert!(
        matches!(&behind, Err(PhoneKeyError::Refused { reason }) if reason.contains("store-behind")),
        "{behind:?}"
    );
}

// A checkpoint file the phone cannot read is not "no checkpoint": the read fails closed, and the
// file is left as it was for the person to see.
#[test]
fn a_damaged_checkpoint_file_fails_the_read_closed() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 52);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, false);
    phone.identity.status().unwrap();

    let path = phone.dir.path().join("log-checkpoints.json");
    std::fs::write(&path, b"{not json").unwrap();
    let restarted = open_identity(&phone.keys, &phone.http, &phone.master);
    let closed = restarted.status();
    assert!(closed.is_err(), "{closed:?}");
    assert!(format!("{closed:?}").contains("checkpoint"), "{closed:?}");
    assert_eq!(std::fs::read(&path).unwrap(), b"{not json");
}

// A device code from another store, or one that expired, is refused before anything is sent.
#[test]
fn a_device_code_of_another_store_is_refused() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 50);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, true);

    let other = ad4m_identity_core::link::DeviceString {
        sign: ad4m_identity_core::build::Signer::key(&SigningKey::from_bytes(&[9; 32])),
        enc: ad4m_identity_core::x25519_multikey_of(&ad4m_identity_core::X25519Secret::from(
            [9; 32],
        )),
        // 16 zero bytes in base58btc.
        r: "1111111111111111".into(),
        exp: 4_000_000_000,
        hint: None,
        store: "https://elsewhere.example".into(),
    };
    let refused = phone.identity.scan_device(other.encode());
    assert!(
        matches!(refused, Err(PhoneKeyError::Refused { .. })),
        "{:?}",
        refused.err()
    );
    assert!(matches!(
        phone.identity.scan_device("coasys:offer:1:nope".into()),
        Err(PhoneKeyError::Invalid { .. })
    ));
}
