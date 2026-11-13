//! The phone against a real identity store, its router in process: the phone's `DeviceKeys`
//! and `PhoneIdentity` over a blocking transport, a computer (`ViaStore` with its master key in
//! a `MemoryVault`) on the other side.
//!
//! The phone's calls block, as they do on Android's background thread; the computer's flows run
//! on the test's runtime between them.

use std::cell::Cell;
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::Poll;

use ad4m_identity_client::flows::create::{CreateFlow, CreateScreen};
use ad4m_identity_client::flows::link::LinkFlow;
use ad4m_identity_client::flows::master::{send_master, take_master};
use ad4m_identity_client::flows::requests::{answer, ask_confirm_revoke, ask_for_master};
use ad4m_identity_client::flows::rotate::rotate;
use ad4m_identity_client::record;
use ad4m_identity_client::{
    ClientError, ExecutorRpc, HttpClient, HttpError, HttpRequest, HttpResponse, MemoryVault,
    OsRandom, RpcError, SoftEncKey, StoreEndpoint, SystemClock, Vault, ViaExecutor, ViaStore,
};
use ad4m_identity_core::link::OfferKind;
use ad4m_identity_core::record::{DeviceEntry, DeviceKind, HoldsMaster, Place};
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
    ClaimProgress, DeviceKeys, Header, IdentitySteps, LinkStep, MasterSealError, MasterSealer,
    PhoneIdentity, PhoneInput, PhoneKeyError, PhoneScreen, RestoreDeviceView, SealError, Sealer,
    StoreConfig, StoreReply, StoreRequest, StoreTransport, TransportError,
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

/// The phone's transport: blocking, as the app's is. `offline` answers no request;
/// `refuse_publish` answers no publish of a log's events, as a connection lost at that moment.
/// `appends` keeps the body of each publish that went out.
struct PhoneHttp {
    rt: Arc<Runtime>,
    router: Router,
    offline: AtomicBool,
    refuse_publish: AtomicBool,
    sent: AtomicUsize,
    appends: Mutex<Vec<Value>>,
}

impl StoreTransport for PhoneHttp {
    fn send(&self, request: StoreRequest) -> Result<StoreReply, TransportError> {
        if self.offline.load(Ordering::SeqCst) {
            return Err(TransportError::Failed {
                reason: "Unable to resolve host \"store.test\"".into(),
            });
        }
        let append = request.method == "POST" && request.url.ends_with("/events");
        if append && self.refuse_publish.load(Ordering::SeqCst) {
            return Err(TransportError::Failed {
                reason: "Software caused connection abort".into(),
            });
        }
        if append {
            self.appends
                .lock()
                .unwrap()
                .push(serde_json::from_slice(&request.body).unwrap_or(Value::Null));
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
    /// Fingers for the prompts to come, in order, before `finger` answers again.
    script: Mutex<std::collections::VecDeque<Finger>>,
    prompts: Mutex<Vec<String>>,
    opened: Mutex<Vec<String>>,
}

impl MasterKeystore {
    fn new(protection: &str) -> Arc<Self> {
        Arc::new(MasterKeystore {
            protection: Mutex::new(protection.into()),
            finger: Mutex::new(Finger::Touch),
            script: Mutex::new(std::collections::VecDeque::new()),
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
    /// The fingers of the next prompts, one each, in order.
    fn script(&self, fingers: &[Finger]) {
        self.script.lock().unwrap().extend(fingers);
    }
    fn prompt(&self, prompt: String) -> Result<(), MasterSealError> {
        self.prompts.lock().unwrap().push(prompt);
        let scripted = self.script.lock().unwrap().pop_front();
        match scripted.unwrap_or(*self.finger.lock().unwrap()) {
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
        refuse_publish: AtomicBool::new(false),
        sent: AtomicUsize::new(0),
        appends: Mutex::new(Vec::new()),
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
        vault: None,
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
            &SystemClock,
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
    // The phone sees the key waiting without a prompt, and seeing it leaves it there.
    assert!(phone.identity.master_waiting().unwrap());
    assert!(phone.identity.master_waiting().unwrap());
    assert!(phone.master.prompts().is_empty());

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
    assert!(!phone.identity.master_waiting().unwrap());

    // The record, as the computer reads it, says the phone holds master #0.
    let opened = world
        .on(record::read(&laptop.exec, &laptop.vault, &did))
        .unwrap()
        .unwrap();
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
    laptop.vault.forget_master(&scid(&did), 0).unwrap();
    let id = world.on(ask_for_master(&laptop.exec, None)).unwrap();

    let listed = phone.identity.requests().unwrap();
    assert_eq!(listed.len(), 1, "{listed:?}");
    let request = &listed[0];
    assert_eq!(request.id, id);
    assert_eq!(request.kind, "send-master");
    assert_eq!(request.by, "d1");
    assert_eq!(request.device, "Laptop");
    assert_eq!(request.problem, None);
    assert!(request.targets.is_empty() && request.target_keys.is_empty());
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

/// The computer's executor, cut off once its rotation's publish has landed: the publish answers
/// nothing, so the flow never re-attests the record's recovery key with the new master.
struct CutOffAfterPublish<'a> {
    inner: &'a ViaStore,
    published: Cell<bool>,
}

#[async_trait(?Send)]
impl ExecutorRpc for CutOffAfterPublish<'_> {
    async fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let answer = self.inner.call(method, params).await;
        if method == "identity.publish" {
            self.published.set(true);
            std::future::pending::<()>().await;
        }
        answer
    }
}

// A rotation lands and its flow is cut off before the record's recovery key is re-attested by the
// new master. The computer sends the phone master #1 while the record is still stale: the phone's
// own record write is refused, so the take signs the mark with the master it just took (a second
// prompt, for the record), which re-attests the recovery key and lists the phone holding #1.
#[test]
fn a_take_while_the_record_waits_for_reattestation_marks_the_phone_with_the_master() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 48);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, false);

    let cut = ViaExecutor::new(CutOffAfterPublish {
        inner: laptop.exec.rpc(),
        published: Cell::new(false),
    });
    let words = words::from_entropy(&[48; 16]);
    let mut rotating = std::pin::pin!(rotate(
        &cut,
        &laptop.vault,
        &did,
        &words,
        &[],
        &SystemClock,
        &OsRandom
    ));
    world.on(std::future::poll_fn(|cx| {
        match rotating.as_mut().poll(cx) {
            Poll::Ready(rotated) => panic!("the rotation was not cut off: {rotated:?}"),
            Poll::Pending if cut.rpc().published.get() => Poll::Ready(()),
            Poll::Pending => Poll::Pending,
        }
    }));
    let events = world.on(laptop.exec.events(&did)).unwrap();
    let chain = ad4m_identity_core::fold(&events).unwrap();
    assert_eq!(chain.state().masters.len(), 2, "the rotation landed");

    // The laptop keeps #1 and pushes it to the phone; its own record write is refused.
    laptop.vault.promote_master(&scid(&did), 1).unwrap();
    let sent = world
        .on(send_master(
            &laptop.exec,
            &laptop.vault,
            &did,
            "d2",
            &SystemClock,
            &OsRandom,
        ))
        .unwrap();
    assert!(
        matches!(sent.record, Err(ClientError::RecoveryNeedsReattest)),
        "{:?}",
        sent.record
    );

    let taken = phone
        .identity
        .take_master(false)
        .unwrap()
        .expect("master #1 waits");
    assert_eq!(taken.index, 1);
    assert_eq!(taken.note, None, "the mark was completed");
    assert_eq!(
        phone.master.prompts(),
        vec![
            "Keep your master key on this phone",
            "Update your identity's private record"
        ]
    );
    assert_eq!(phone.identity.take_master(false).unwrap(), None);

    // The record lists the phone holding #1, its recovery key attested by master #1.
    let opened = world
        .on(record::read(&laptop.exec, &laptop.vault, &did))
        .unwrap()
        .unwrap();
    assert_eq!(opened.record.devices["d2"].holds_master, HoldsMaster::Yes);
    assert_eq!(opened.record.devices["d2"].master_index, Some(1));
    assert_eq!(opened.recovery.unwrap().attestation.key_id, "m1");
}

// The same take, with the record's prompt cancelled: the phone keeps master #1 and owes the
// record its mark. No message waits after a restart, and "Take the master key" is still offered:
// the take makes the mark now (one prompt, for the record), with the person's consent.
#[test]
fn a_mark_a_cancelled_take_still_owes_is_made_by_a_take_after_a_restart() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 49);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, false);

    let cut = ViaExecutor::new(CutOffAfterPublish {
        inner: laptop.exec.rpc(),
        published: Cell::new(false),
    });
    let words = words::from_entropy(&[49; 16]);
    let mut rotating = std::pin::pin!(rotate(
        &cut,
        &laptop.vault,
        &did,
        &words,
        &[],
        &SystemClock,
        &OsRandom
    ));
    world.on(std::future::poll_fn(|cx| {
        match rotating.as_mut().poll(cx) {
            Poll::Ready(rotated) => panic!("the rotation was not cut off: {rotated:?}"),
            Poll::Pending if cut.rpc().published.get() => Poll::Ready(()),
            Poll::Pending => Poll::Pending,
        }
    }));
    laptop.vault.promote_master(&scid(&did), 1).unwrap();
    world
        .on(send_master(
            &laptop.exec,
            &laptop.vault,
            &did,
            "d2",
            &SystemClock,
            &OsRandom,
        ))
        .unwrap();

    // The seal is touched, the record's prompt is cancelled.
    phone.master.script(&[Finger::Touch, Finger::Cancel]);
    let taken = phone
        .identity
        .take_master(false)
        .unwrap()
        .expect("master #1 waits");
    assert_eq!(taken.index, 1);
    assert!(taken.note.is_some(), "the mark was not made");
    assert_eq!(phone.master.prompts().len(), 2);
    let opened = world
        .on(record::read(&laptop.exec, &laptop.vault, &did))
        .unwrap()
        .unwrap();
    assert_ne!(opened.record.devices["d2"].master_index, Some(1));

    // A restart: no message waits, the mark is still owed, and the take makes it.
    let restarted = open_identity(&phone.keys, &phone.http, &phone.master);
    assert!(
        restarted.master_waiting().unwrap(),
        "the owed mark is offered"
    );
    let repaired = restarted
        .take_master(false)
        .unwrap()
        .expect("the owed mark is made");
    assert_eq!(repaired.index, 1);
    assert_eq!(repaired.note, None, "the mark was made");
    assert_eq!(
        phone.master.prompts()[2..],
        ["Update your identity's private record".to_string()]
    );
    assert!(!restarted.master_waiting().unwrap());
    assert_eq!(restarted.take_master(false).unwrap(), None);

    let opened = world
        .on(record::read(&laptop.exec, &laptop.vault, &did))
        .unwrap()
        .unwrap();
    assert_eq!(opened.record.devices["d2"].holds_master, HoldsMaster::Yes);
    assert_eq!(opened.record.devices["d2"].master_index, Some(1));
    assert_eq!(opened.recovery.unwrap().attestation.key_id, "m1");
}

// A revoke request lists the keys it names by id, beside the names the record gives them: the ids
// say which keys go.
#[test]
fn a_revoke_request_names_its_keys_by_id() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 47);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, true);

    let id = world
        .on(ask_confirm_revoke(
            &laptop.exec,
            &did,
            &["d1".to_string()],
            false,
            None,
        ))
        .unwrap();
    let listed = phone.identity.requests().unwrap();
    let request = listed.iter().find(|r| r.id == id).expect("the request");
    assert_eq!(request.kind, "confirm-revoke");
    assert_eq!(request.target_keys, vec!["d1".to_string()]);
    assert_eq!(request.targets, vec!["Laptop".to_string()]);
    assert!(!request.rotate);
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
    assert!(!link.ended());
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
    // The link's thread is over: the app can drop the handle without polling `next` again.
    assert!(link.ended());

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

// A computer that adds the phone through a node offer cannot tell it is a phone (a claim carries
// no kind) and writes it as a server, as WE's desktop does. The phone's first read of its devices
// writes its own entry as a phone app, keeping its name, and every device reads it so after.
#[test]
fn the_phone_writes_itself_as_a_phone_where_it_was_added_as_a_server() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 54);
    let phone = phone(&world, "strongbox");
    let flow = world
        .on(LinkFlow::open(
            &laptop.exec,
            &laptop.vault,
            &did,
            OfferKind::Node,
            None,
            STORE_URL,
            &SystemClock,
            &OsRandom,
        ))
        .unwrap();
    let prepared = phone.claim(&flow.link());
    let claimed = world.on(flow.wait_for_claim()).unwrap();
    let as_server = DeviceEntry {
        place: Some(Place::Server),
        runs_executor: true,
        ..entry("Pixel 8", DeviceKind::Server)
    };
    world.on(flow.confirm(&claimed, as_server, false)).unwrap();
    phone.joined(&prepared);

    let devices = phone.identity.devices().unwrap();
    let me = devices.iter().find(|d| d.this_device).unwrap();
    assert_eq!(me.kind.as_deref(), Some("phone-app"));
    assert_eq!(me.name, "Pixel 8");
    let laptop_row = devices.iter().find(|d| d.key_id == "d1").unwrap();
    assert_eq!(laptop_row.kind.as_deref(), Some("desktop-app"));

    let opened = world
        .on(record::read(&laptop.exec, &laptop.vault, &did))
        .unwrap()
        .unwrap();
    let written = &opened.record.devices["d2"];
    assert_eq!(written.kind, DeviceKind::PhoneApp);
    assert_eq!(written.place, None);
    assert!(!written.runs_executor);
    assert_eq!(written.name, "Pixel 8");

    // Once it says so, a read writes nothing more.
    let version = opened.version;
    phone.identity.devices().unwrap();
    let again = world
        .on(record::read(&laptop.exec, &laptop.vault, &did))
        .unwrap()
        .unwrap();
    assert_eq!(again.version, version);
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

// A record that is there and cannot be read is an error, not a device list with every name
// gone: here the store serves a version older than the one the phone has already read (its
// high-water mark, kept in `master-keys.json`, persists across a restart).
#[test]
fn a_record_the_phone_cannot_read_is_an_error_not_a_list_without_names() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 53);
    let phone = phone(&world, "strongbox");
    join(&world, &laptop, &phone, &did, false);

    let devices = phone.identity.devices().unwrap();
    assert_eq!(devices[0].name, "Laptop");

    let path = phone.dir.path().join("master-keys.json");
    let mut kept: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let seen = kept["seen"]
        .as_array_mut()
        .expect("the record's mark is kept");
    let mark = seen
        .iter_mut()
        .find(|s| s["scid"] == scid(&did))
        .expect("this identity's mark");
    let version = mark["version"].as_u64().expect("a version read");
    mark["version"] = json!(version + 5);
    std::fs::write(&path, serde_json::to_vec(&kept).unwrap()).unwrap();

    let restarted = open_identity(&phone.keys, &phone.http, &phone.master);
    let devices = restarted.devices();
    assert!(
        matches!(&devices, Err(e) if format!("{e:?}").contains("record")),
        "{devices:?}"
    );
    let requests = restarted.requests();
    assert!(requests.is_err(), "{requests:?}");
    // The log itself still reads: only the record is refused.
    restarted.status().unwrap();
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

// ─── make, restore and replace on the phone ─────────────────────────────────────────────

/// The words a make showed, and the two asked back.
fn answers(words: &[String], positions: &[u32]) -> PhoneInput {
    PhoneInput::ConfirmWords {
        first: words[positions[0] as usize - 1].clone(),
        second: words[positions[1] as usize - 1].clone(),
    }
}

/// A make on `phone` through to its name, the words written and confirmed: the steps (the next
/// answer is the make's end) and the words it showed.
fn made_to_name(phone: &Phone) -> (Arc<IdentitySteps>, Vec<String>) {
    let steps = phone.identity.start_make(false).unwrap();
    let PhoneScreen::ShowWords { words } = steps.next().unwrap() else {
        panic!("a make starts with its words");
    };
    let PhoneScreen::ConfirmWords { positions, .. } = steps.step(PhoneInput::WordsWritten).unwrap()
    else {
        panic!("then asks two of them back");
    };
    assert_eq!(
        steps.step(answers(&words, &positions)).unwrap(),
        PhoneScreen::NameDevice
    );
    (steps, words)
}

/// A new identity made on `phone`: its did and the words.
fn made(phone: &Phone) -> (String, Vec<String>) {
    let (steps, words) = made_to_name(phone);
    let PhoneScreen::IdentityReady { did, .. } = steps
        .step(PhoneInput::NameDevice {
            name: Some("Pixel".into()),
        })
        .unwrap()
    else {
        panic!("the make ends with the identity");
    };
    (did, words)
}

fn spelled(entropy: u8) -> String {
    words::from_entropy(&[entropy; 16])
        .words()
        .iter()
        .map(|w| w.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

// The phone makes an identity with no computer: 12 new words shown once, two of them asked back
// (a wrong one asked again), the phone named, master #0 kept behind the prompt and the incept
// published straight to the store with the store's proof of work. The key file records the
// identity, and the record lists the phone as a phone app holding master #0.
#[test]
fn the_phone_makes_an_identity_from_new_words() {
    let world = world();
    let phone = phone(&world, "strongbox");
    let steps = phone.identity.start_make(false).unwrap();
    let PhoneScreen::ShowWords { words } = steps.next().unwrap() else {
        panic!("a make starts with its words");
    };
    assert_eq!(words.len(), 12);
    // An input that does not answer the screen leaves the flow where it was.
    assert!(matches!(
        steps.step(PhoneInput::TryAgain),
        Err(PhoneKeyError::WrongInput)
    ));
    let PhoneScreen::ConfirmWords { positions, error } =
        steps.step(PhoneInput::WordsWritten).unwrap()
    else {
        panic!("two words asked back");
    };
    assert_eq!(error, None);
    assert!(positions[0] < positions[1] && positions[1] <= 12);
    let wrong = if words[positions[0] as usize - 1] == "zoo" {
        "abandon"
    } else {
        "zoo"
    };
    let again = steps
        .step(PhoneInput::ConfirmWords {
            first: wrong.into(),
            second: words[positions[1] as usize - 1].clone(),
        })
        .unwrap();
    assert_eq!(
        again,
        PhoneScreen::ConfirmWords {
            positions: positions.clone(),
            error: Some(we_identity_steps::WRONG_CONFIRM.into()),
        }
    );
    // Case and the spaces around a word do not count.
    let first = format!(" {} ", words[positions[0] as usize - 1].to_uppercase());
    let named = steps
        .step(PhoneInput::ConfirmWords {
            first,
            second: words[positions[1] as usize - 1].clone(),
        })
        .unwrap();
    assert_eq!(named, PhoneScreen::NameDevice);
    assert!(
        phone.master.prompts().is_empty(),
        "no prompt before the name"
    );
    let ready = steps
        .step(PhoneInput::NameDevice {
            name: Some(" Pixel ".into()),
        })
        .unwrap();
    let PhoneScreen::IdentityReady { did, key_id, note } = ready else {
        panic!("expected the identity, got {ready:?}");
    };
    assert_eq!(key_id, "d1");
    assert_eq!(note, None);
    assert!(steps.ended(), "ended is set before the last screen is sent");
    assert!(matches!(steps.next(), Err(PhoneKeyError::Ended { .. })));
    assert!(matches!(
        steps.step(PhoneInput::TryAgain),
        Err(PhoneKeyError::Ended { .. })
    ));

    // One prompt: master #0 kept.
    assert_eq!(
        phone.master.prompts(),
        vec!["Keep your master key on this phone".to_string()]
    );
    // The incept went out with a proof at the store's bits, and only the incept.
    let appends = phone.http.appends.lock().unwrap().clone();
    assert_eq!(appends.len(), 1, "{appends:?}");
    assert_eq!(appends[0]["pow"]["bits"], 8);
    assert_eq!(appends[0]["events"][0]["seq"], 0);

    let member = phone
        .keys
        .status()
        .identity
        .expect("the key file records it");
    assert_eq!(member.did, did);
    assert_eq!(member.seq, Some(0));
    let status = phone.identity.status().unwrap();
    assert_eq!(status.master_index, Some(0));
    assert_eq!(status.key_id.as_deref(), Some("d1"));
    let devices = phone.identity.devices().unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].name, "Pixel");
    assert_eq!(devices[0].kind.as_deref(), Some("phone-app"));
    assert_eq!(devices[0].holds_master, "yes");
    assert!(devices[0].this_device);
    assert_eq!(phone.identity.pending_identity().unwrap(), None);

    // A phone in an identity makes no other, and restores none.
    let again = phone.identity.start_make(false).unwrap();
    assert!(matches!(
        again.next(),
        Err(PhoneKeyError::AlreadyJoined { did: d }) if d == did
    ));
    let restore = phone.identity.start_restore(false).unwrap();
    assert!(matches!(
        restore.next(),
        Err(PhoneKeyError::AlreadyJoined { .. })
    ));

    // The words the phone showed are the identity's: a computer restores from them.
    let laptop = computer(&world, 3);
    let flow = world
        .on(ad4m_identity_client::flows::restore::RestoreFlow::start(
            &laptop.exec,
            &laptop.vault,
            &words.join(" "),
            &SystemClock,
            &OsRandom,
        ))
        .unwrap();
    assert_eq!(flow.did(), did);
}

// A key store that is not secure hardware keeps no master key until the person agrees: refused
// before any word is made. A replace needs an identity.
#[test]
fn a_make_on_a_software_keystore_waits_for_the_person_to_agree() {
    let world = world();
    let phone = phone(&world, "software");
    assert!(matches!(
        phone.identity.start_make(false),
        Err(PhoneKeyError::WeakProtection { protection }) if protection == "software"
    ));
    assert!(matches!(
        phone.identity.start_restore(false),
        Err(PhoneKeyError::WeakProtection { .. })
    ));
    assert!(matches!(
        phone.identity.start_rotate(true),
        Err(PhoneKeyError::NoIdentity)
    ));
    let (did, _) = made_with(&phone, true);
    assert_eq!(phone.identity.status().unwrap().did, did);
}

fn made_with(phone: &Phone, allow_weak: bool) -> (String, Vec<String>) {
    let steps = phone.identity.start_make(allow_weak).unwrap();
    let PhoneScreen::ShowWords { words } = steps.next().unwrap() else {
        panic!("a make starts with its words");
    };
    let PhoneScreen::ConfirmWords { positions, .. } = steps.step(PhoneInput::WordsWritten).unwrap()
    else {
        panic!("then asks two back");
    };
    steps.step(answers(&words, &positions)).unwrap();
    let PhoneScreen::IdentityReady { did, .. } =
        steps.step(PhoneInput::NameDevice { name: None }).unwrap()
    else {
        panic!("the make ends with the identity");
    };
    (did, words)
}

// A make whose publish does not land keeps the identity pending: the phone keeps master #0 and
// the incept, says so, and Try again publishes the same identity, not a new one.
#[test]
fn a_make_whose_publish_failed_is_published_on_try_again() {
    let world = world();
    let phone = phone(&world, "strongbox");
    let (steps, words) = made_to_name(&phone);
    phone.http.refuse_publish.store(true, Ordering::SeqCst);
    let stopped = steps
        .step(PhoneInput::NameDevice {
            name: Some("Pixel".into()),
        })
        .unwrap();
    let PhoneScreen::MakeStopped {
        did: Some(did),
        reason,
        pending: true,
    } = stopped
    else {
        panic!("expected a pending identity, got {stopped:?}");
    };
    assert!(reason.contains("not published yet"), "{reason}");
    // The phrase, not one word: a single word ("phone", "again") can be part of the reason's text.
    assert!(
        !reason.contains(&words.join(" ")),
        "the reason never names the words"
    );
    assert_eq!(
        phone.identity.pending_identity().unwrap(),
        Some(did.clone())
    );
    assert_eq!(
        phone.keys.status().identity,
        None,
        "not recorded before it is published"
    );

    // Still offline: the same screen again.
    assert!(matches!(
        steps.step(PhoneInput::TryAgain).unwrap(),
        PhoneScreen::MakeStopped { pending: true, .. }
    ));
    phone.http.refuse_publish.store(false, Ordering::SeqCst);
    let ready = steps.step(PhoneInput::TryAgain).unwrap();
    assert!(
        matches!(&ready, PhoneScreen::IdentityReady { did: d, .. } if *d == did),
        "{ready:?}"
    );
    // Master #0 was kept once, on the first try.
    assert_eq!(
        phone.master.prompts().len(),
        1,
        "{:?}",
        phone.master.prompts()
    );
    assert_eq!(phone.keys.status().identity.unwrap().did, did);
    assert_eq!(phone.identity.pending_identity().unwrap(), None);
    assert_eq!(phone.identity.status().unwrap().master_index, Some(0));
}

// A make cancelled after the publish failed leaves the identity pending, with no words held:
// `finish_pending` publishes it with no prompt once the store answers (and says Unavailable
// while it does not), and a make started meanwhile publishes it rather than make another.
#[test]
fn a_pending_identity_is_published_after_the_flow_is_gone() {
    let world = world();
    let phone = phone(&world, "strongbox");
    let (steps, _) = made_to_name(&phone);
    phone.http.refuse_publish.store(true, Ordering::SeqCst);
    let PhoneScreen::MakeStopped { did: Some(did), .. } =
        steps.step(PhoneInput::NameDevice { name: None }).unwrap()
    else {
        panic!("expected the make stopped");
    };
    steps.cancel();
    assert!(matches!(
        steps.step(PhoneInput::TryAgain),
        Err(PhoneKeyError::Ended { .. })
    ));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !steps.ended() {
        assert!(
            std::time::Instant::now() < deadline,
            "the flow's thread ends"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let prompts = phone.master.prompts().len();
    assert!(matches!(
        phone.identity.finish_pending(),
        Err(PhoneKeyError::Unavailable { .. })
    ));
    assert_eq!(
        phone.identity.pending_identity().unwrap(),
        Some(did.clone())
    );

    phone.http.refuse_publish.store(false, Ordering::SeqCst);
    // A make started now publishes the identity kept, as its first screen.
    let again = phone.identity.start_make(false).unwrap();
    let ready = again.next().unwrap();
    assert!(
        matches!(&ready, PhoneScreen::IdentityReady { did: d, note: Some(_), .. } if *d == did),
        "{ready:?}"
    );
    assert_eq!(
        phone.master.prompts().len(),
        prompts,
        "no prompt to publish"
    );
    assert_eq!(phone.keys.status().identity.unwrap().did, did);
    assert_eq!(phone.identity.finish_pending().unwrap(), None);
    assert_eq!(phone.identity.status().unwrap().master_index, Some(0));
}

// A make cancelled while its words are shown ends: no more input is taken, nothing was kept or
// published, and the next make shows new words.
#[test]
fn a_cancelled_make_ends_and_keeps_nothing() {
    let world = world();
    let phone = phone(&world, "strongbox");
    let steps = phone.identity.start_make(false).unwrap();
    let PhoneScreen::ShowWords { words } = steps.next().unwrap() else {
        panic!("a make starts with its words");
    };
    steps.cancel();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !steps.ended() {
        assert!(
            std::time::Instant::now() < deadline,
            "the flow's thread ends"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(matches!(
        steps.step(PhoneInput::WordsWritten),
        Err(PhoneKeyError::Ended { .. })
    ));
    assert!(phone.master.prompts().is_empty());
    assert!(phone.http.appends.lock().unwrap().is_empty());
    assert_eq!(phone.identity.pending_identity().unwrap(), None);
    // A dropped handle ends its flow too.
    let other = phone.identity.start_make(false).unwrap();
    let PhoneScreen::ShowWords { words: next } = other.next().unwrap() else {
        panic!("new words");
    };
    assert_ne!(next, words);
    drop(other);
}

// The phone restores an identity a computer made, from its 12 words: typed words that are not
// 12, or not the identity's, are asked again; the computer is listed and ticked; one rotation
// locks it out and keeps the new master key on the phone, which joins as a device.
#[test]
fn the_phone_restores_an_identity_and_locks_out_a_lost_computer() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 61);
    let phone = phone(&world, "strongbox");

    let steps = phone.identity.start_restore(false).unwrap();
    assert_eq!(
        steps.next().unwrap(),
        PhoneScreen::EnterWords {
            purpose: "restore".into(),
            error: None,
            position: None,
        }
    );
    let short = steps
        .step(PhoneInput::TwelveWords {
            words: "abandon ability".into(),
        })
        .unwrap();
    assert!(
        matches!(&short, PhoneScreen::EnterWords { error: Some(e), .. } if e.starts_with("That is 2 words")),
        "{short:?}"
    );
    let mut typo: Vec<String> = spelled(61).split(' ').map(String::from).collect();
    typo[3] = "zzzzq".into();
    let typo = steps
        .step(PhoneInput::TwelveWords {
            words: typo.join(" "),
        })
        .unwrap();
    let PhoneScreen::EnterWords {
        error: Some(error),
        position: Some(4),
        ..
    } = typo
    else {
        panic!("a word not on the list is named by its place, got {typo:?}");
    };
    assert!(!error.contains("zzzzq"));
    let other = steps
        .step(PhoneInput::TwelveWords { words: spelled(62) })
        .unwrap();
    assert_eq!(
        other,
        PhoneScreen::EnterWords {
            purpose: "restore".into(),
            error: Some(we_identity_steps::NOT_THESE_WORDS.into()),
            position: None,
        }
    );
    let listed = steps
        .step(PhoneInput::TwelveWords {
            words: format!("  {}  ", spelled(61).to_uppercase()),
        })
        .unwrap();
    let PhoneScreen::RestoreDevices {
        did: found,
        devices,
        note,
    } = listed
    else {
        panic!("expected the devices, got {listed:?}");
    };
    assert_eq!(found, did);
    assert_eq!(note, None);
    assert_eq!(
        devices,
        vec![RestoreDeviceView {
            key_id: "d1".into(),
            name: Some("Laptop".into()),
            kind: Some("desktop-app".into()),
            lock_out: true,
        }]
    );
    assert!(matches!(
        steps.step(PhoneInput::LockOut {
            key_ids: vec!["d9".into()],
            name: None,
        }),
        Err(PhoneKeyError::WrongInput)
    ));
    let restored = steps
        .step(PhoneInput::LockOut {
            key_ids: vec!["d1".into()],
            name: Some("Pixel".into()),
        })
        .unwrap();
    let PhoneScreen::Restored {
        did: restored_did,
        name,
        key_id,
        revoked,
        note,
    } = restored
    else {
        panic!("expected restored, got {restored:?}");
    };
    assert_eq!(restored_did, did);
    assert_eq!(name, "Pixel");
    assert_eq!(revoked, vec!["d1".to_string()]);
    assert_eq!(note, None);
    assert!(steps.ended());

    assert_eq!(phone.keys.status().identity.unwrap().did, did);
    let status = phone.identity.status().unwrap();
    assert_eq!(status.master_index, Some(1));
    assert_eq!(status.key_id.as_deref(), Some(key_id.as_str()));
    let devices = phone.identity.devices().unwrap();
    let laptop_now = devices.iter().find(|d| d.key_id == "d1").unwrap();
    assert!(laptop_now.revoked_seq.is_some(), "the laptop is locked out");
    let me = devices.iter().find(|d| d.this_device).unwrap();
    assert_eq!(me.kind.as_deref(), Some("phone-app"));
    assert_eq!(me.holds_master, "yes");
    assert_eq!(me.master_index, Some(1));
}

/// Blocks every write of `phone`'s key file and nothing else: a directory where the write puts
/// its temporary file. The master-key and checkpoint files beside it are still written.
fn block_key_file(phone: &Phone) -> std::path::PathBuf {
    let blocker = phone.dir.path().join("device-keys.json.tmp");
    std::fs::create_dir(&blocker).unwrap();
    blocker
}

fn wait_ended(steps: &IdentitySteps) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !steps.ended() {
        assert!(
            std::time::Instant::now() < deadline,
            "the flow's thread ends"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

/// `phone` as the app opens it again: its key file and vault read afresh from the same folder.
fn reopened(phone: &Phone) -> (Arc<DeviceKeys>, Arc<PhoneIdentity>) {
    let keys = DeviceKeys::open(
        phone.dir.path().to_string_lossy().into(),
        phone.sealer.clone(),
    )
    .unwrap();
    let identity = open_identity(&keys, &phone.http, &phone.master);
    (keys, identity)
}

// A make whose key file is not written after the publish (the write fails, or the app is killed
// then) leaves the phone in a log its key file does not name, with no incept pending. Opened
// again on the same key and vault, the phone finds itself in the store's verified log and
// records that identity: its status reads, and a replace of the master key starts.
#[test]
fn a_make_stopped_between_its_publish_and_the_key_file_is_recorded_when_opened_again() {
    let world = world();
    let phone = phone(&world, "strongbox");
    let (steps, _) = made_to_name(&phone);
    let blocker = block_key_file(&phone);
    let stopped = steps.step(PhoneInput::NameDevice {
        name: Some("Pixel".into()),
    });
    assert!(
        matches!(stopped, Err(PhoneKeyError::Io { .. })),
        "{stopped:?}"
    );
    wait_ended(&steps);
    assert_eq!(phone.http.appends.lock().unwrap().len(), 1, "published");
    assert_eq!(phone.keys.status().identity, None);
    std::fs::remove_dir(&blocker).unwrap();

    let (keys, identity) = reopened(&phone);
    assert_eq!(keys.status().identity, None, "the key file names none");
    assert_eq!(identity.pending_identity().unwrap(), None, "none pending");
    assert_eq!(identity.finish_pending().unwrap(), None);
    let status = identity.status().unwrap();
    assert_eq!(status.key_id.as_deref(), Some("d1"));
    assert_eq!(status.master_index, Some(0));
    assert_eq!(keys.status().identity.unwrap().did, status.did);
    let rotate = identity.start_rotate(false).unwrap();
    assert!(matches!(
        rotate.next().unwrap(),
        PhoneScreen::EnterWords { purpose, .. } if purpose == "replace"
    ));
}

// The same for a restore: its rotation and this phone's enrolment are published, and the key
// file is not written. Opened again, a make or a restore records the identity the store lists
// this phone in, then refuses as for any phone in an identity; the phone replaces its master key.
#[test]
fn a_restore_stopped_between_its_enrolment_and_the_key_file_is_recorded_when_opened_again() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 61);
    let phone = phone(&world, "strongbox");
    let steps = phone.identity.start_restore(false).unwrap();
    steps.next().unwrap();
    let listed = steps
        .step(PhoneInput::TwelveWords { words: spelled(61) })
        .unwrap();
    assert!(
        matches!(listed, PhoneScreen::RestoreDevices { .. }),
        "{listed:?}"
    );
    let blocker = block_key_file(&phone);
    let stopped = steps.step(PhoneInput::LockOut {
        key_ids: vec!["d1".into()],
        name: Some("Pixel".into()),
    });
    assert!(
        matches!(stopped, Err(PhoneKeyError::Io { .. })),
        "{stopped:?}"
    );
    wait_ended(&steps);
    assert_eq!(phone.keys.status().identity, None);
    std::fs::remove_dir(&blocker).unwrap();

    let (keys, identity) = reopened(&phone);
    assert_eq!(keys.status().identity, None, "the key file names none");
    let again = identity.start_restore(false).unwrap();
    assert!(matches!(
        again.next(),
        Err(PhoneKeyError::AlreadyJoined { did: d }) if d == did
    ));
    assert_eq!(keys.status().identity.unwrap().did, did, "recorded");
    let status = identity.status().unwrap();
    assert_eq!(status.did, did);
    assert_eq!(status.master_index, Some(1));
    assert!(status.key_id.is_some() && status.revoked.is_none());
    let rotate = identity.start_rotate(false).unwrap();
    assert!(matches!(
        rotate.next().unwrap(),
        PhoneScreen::EnterWords { purpose, .. } if purpose == "replace"
    ));
}

// A restore stopped before its key file, as above, and then another device removes this phone:
// a second phone restores the same words and locks it out. Opened again, the phone does not
// record the identity that revoked it: its status, a make and a restore say it was removed.
#[test]
fn a_phone_revoked_before_its_key_file_was_written_is_not_recorded_when_opened_again() {
    let world = world();
    let laptop = computer(&world, 1);
    let did = create(&world, &laptop, 61);
    let phone = phone(&world, "strongbox");
    let steps = phone.identity.start_restore(false).unwrap();
    steps.next().unwrap();
    steps
        .step(PhoneInput::TwelveWords { words: spelled(61) })
        .unwrap();
    let blocker = block_key_file(&phone);
    let stopped = steps.step(PhoneInput::LockOut {
        key_ids: vec!["d1".into()],
        name: Some("Pixel".into()),
    });
    assert!(
        matches!(stopped, Err(PhoneKeyError::Io { .. })),
        "{stopped:?}"
    );
    wait_ended(&steps);
    std::fs::remove_dir(&blocker).unwrap();

    let other = self::phone(&world, "strongbox");
    let steps = other.identity.start_restore(false).unwrap();
    steps.next().unwrap();
    let PhoneScreen::RestoreDevices { devices, .. } = steps
        .step(PhoneInput::TwelveWords { words: spelled(61) })
        .unwrap()
    else {
        panic!("expected the devices");
    };
    let pixel = devices
        .iter()
        .find(|d| d.name.as_deref() == Some("Pixel"))
        .expect("the first phone is listed")
        .key_id
        .clone();
    let restored = steps
        .step(PhoneInput::LockOut {
            key_ids: vec![pixel],
            name: Some("Tablet".into()),
        })
        .unwrap();
    assert!(
        matches!(&restored, PhoneScreen::Restored { did: d, .. } if *d == did),
        "{restored:?}"
    );

    let (keys, identity) = reopened(&phone);
    let removed = |e: &PhoneKeyError| matches!(e, PhoneKeyError::Refused { reason } if reason == we_phone_custody::REMOVED);
    let status = identity.status();
    assert!(status.as_ref().is_err_and(removed), "{status:?}");
    assert_eq!(keys.status().identity, None, "not recorded");
    let again = identity.start_restore(false).unwrap().next();
    assert!(again.as_ref().is_err_and(removed), "{again:?}");
    let make = identity.start_make(false).unwrap().next();
    assert!(make.as_ref().is_err_and(removed), "{make:?}");
    assert_eq!(keys.status().identity, None, "still not recorded");
}

// The phone replaces its master key with the words it showed at the make: words that are not
// the identity's change nothing and are asked again; the right ones make master #1, kept here.
#[test]
fn the_phone_replaces_its_master_key_with_the_words() {
    let world = world();
    let phone = phone(&world, "strongbox");
    let (did, words) = made(&phone);
    let prompts = phone.master.prompts().len();

    let steps = phone.identity.start_rotate(false).unwrap();
    assert_eq!(
        steps.next().unwrap(),
        PhoneScreen::EnterWords {
            purpose: "replace".into(),
            error: None,
            position: None,
        }
    );
    let refused = steps
        .step(PhoneInput::TwelveWords { words: spelled(77) })
        .unwrap();
    assert!(
        matches!(&refused, PhoneScreen::EnterWords { error: Some(e), .. } if e == we_identity_steps::NOT_THESE_WORDS),
        "{refused:?}"
    );
    assert_eq!(
        phone.master.prompts().len(),
        prompts,
        "nothing kept for wrong words"
    );
    assert_eq!(phone.identity.status().unwrap().master_index, Some(0));
    let replaced = steps
        .step(PhoneInput::TwelveWords {
            words: words.join(" "),
        })
        .unwrap();
    assert_eq!(
        replaced,
        PhoneScreen::MasterReplaced {
            index: 1,
            revoked: Vec::new(),
            note: None,
        }
    );
    let status = phone.identity.status().unwrap();
    assert_eq!(status.did, did);
    assert_eq!(status.master_index, Some(1));
    assert_eq!(
        phone.identity.retry_master_pushes().unwrap(),
        None,
        "no other app keeps the master key"
    );
}
