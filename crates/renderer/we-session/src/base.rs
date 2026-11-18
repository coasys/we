//! The connect screen's public store.
//!
//! The template is the pinned Coasys base cartridge
//! (`data/coasys-base.pin`). This module serves `baseStore` to that mount
//! and keeps the stage the template reads. It does not dial an executor
//! and it does not hold a token. The host starts a connect attempt only
//! when [`BaseController::apply`] returns a [`HostJob`].

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use we_expr::{BundleSlot, MountCx, Provenance, Tier, Value};
use we_template::{BindingSource, Bound, DataRevision, Invalidator, RootDomain, SchemaNode};

/// The bundle id the host stamps on the built-in base mount.
pub const BUILTIN_BUNDLE: &str = "coasys";

/// What the offline screen says when this computer does not answer.
pub const UNREACHABLE: &str = "Coasys isn't responding.";

const DOOR_NOTE: &str = "Not available on this computer.";

/// One row of `baseStore.connections`.
#[derive(Clone, Debug)]
pub struct ConnectionRow {
    pub id: Arc<str>,
    pub kind: Arc<str>,
    pub icon: Arc<str>,
    pub label: Arc<str>,
    pub detail: Arc<str>,
}

impl ConnectionRow {
    /// This computer, as the desktop host offers it.
    pub fn this_computer() -> Self {
        Self {
            id: "this-device".into(),
            kind: "this-device".into(),
            icon: "laptop".into(),
            label: "This computer".into(),
            detail: "Available while this computer is on".into(),
        }
    }
}

/// The pinned base template. A bundle whose id is [`BUILTIN_BUNDLE`] and
/// which carries `base` wins; every other bundle uses this artifact.
pub fn coasys_base_template() -> SchemaNode {
    serde_json::from_str(include_str!("../data/coasys-base.json"))
        .expect("pinned coasys base template parses")
}

/// The node the connect screen mounts.
pub fn base_template_for(bundle: &we_template::Bundle) -> SchemaNode {
    if bundle.id == BUILTIN_BUNDLE {
        if let Some(base) = &bundle.base {
            return base.clone();
        }
    }
    coasys_base_template()
}

/// `data:image/svg+xml` with the mark percent-encoded. No base64.
fn mark_url() -> String {
    let svg = include_str!("../data/coasys-mark.svg");
    let mut out = String::from("data:image/svg+xml,");
    for byte in svg.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => {
                const HEX: &[u8; 16] = b"0123456789ABCDEF";
                out.push('%');
                out.push(HEX[(byte >> 4) as usize] as char);
                out.push(HEX[(byte & 0xf) as usize] as char);
            }
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Connect,
    HandingOff,
    Offline,
    Session,
    Page,
}

impl Stage {
    fn as_str(self) -> &'static str {
        match self {
            Stage::Connect => "connect",
            Stage::HandingOff => "handing-off",
            Stage::Offline => "offline",
            Stage::Session => "session",
            Stage::Page => "page",
        }
    }
}

struct Inner {
    generation: u64,
    attempt: u64,
    busy: bool,
    stage: Stage,
    page: String,
    error: String,
    offline_reason: String,
    /// The last connect job was a choose (`true`) or a retry (`false`).
    chosen: bool,
    rows: Vec<ConnectionRow>,
}

/// A connect attempt the host should start. `attempt` is the id a later
/// completion must quote. `chosen` is `true` for a click on a row and
/// `false` for retry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostJob {
    pub attempt: u64,
    pub chosen: bool,
}

/// A permitted base-store call, after the gate has checked the arguments.
#[derive(Clone, Debug)]
pub enum BaseCommand {
    Choose(String),
    Retry,
    ShowConnections,
    OpenPage(String),
    ClosePage,
    ClearPasswordWrong,
    /// Identity and password calls. The adapters are absent, so these
    /// change nothing.
    Nop,
}

/// The stage machine. Pure: no runtime, no socket.
pub struct BaseController {
    inner: Mutex<Inner>,
    model: Arc<BaseModel>,
    builtin: Arc<str>,
    mark: String,
}

impl BaseController {
    pub fn new(builtin: impl Into<Arc<str>>, rows: Vec<ConnectionRow>) -> Arc<Self> {
        let this = Arc::new(Self {
            inner: Mutex::new(Inner {
                generation: 1,
                attempt: 0,
                busy: false,
                stage: Stage::Connect,
                page: String::new(),
                error: String::new(),
                offline_reason: String::new(),
                chosen: false,
                rows,
            }),
            model: Arc::new(BaseModel::new()),
            builtin: builtin.into(),
            mark: mark_url(),
        });
        this.publish(&this.lock());
        this
    }

    /// This computer, mounted as [`BUILTIN_BUNDLE`].
    pub fn with_this_computer() -> Arc<Self> {
        Self::new(BUILTIN_BUNDLE, vec![ConnectionRow::this_computer()])
    }

    pub fn bindings(self: &Arc<Self>) -> Arc<dyn BindingSource> {
        Arc::new(BaseBindings {
            builtin: self.builtin.clone(),
            model: self.model.clone(),
        })
    }

    pub fn facts(&self) -> we_template::BasePermitFacts {
        let inner = self.lock();
        we_template::BasePermitFacts {
            builtin: self.builtin.clone(),
            generation: inner.generation,
            catalog: inner.rows.iter().map(|row| row.id.clone()).collect(),
            busy: inner.busy,
        }
    }

    pub fn generation(&self) -> u64 {
        self.lock().generation
    }

    /// The public snapshot as JSON. String values are the words on screen.
    pub fn public_json(&self) -> serde_json::Value {
        let inner = self.lock();
        snap_json(&inner, &self.mark)
    }

    /// Apply a permitted call.
    ///
    /// `generation` is the permit's generation. It must equal the current
    /// generation. A connect call then advances the generation, so a second
    /// permit copied from the same dispatch no longer matches.
    /// A completion for an older attempt does not change this state.
    pub fn apply(&self, command: BaseCommand, generation: u64) -> Option<HostJob> {
        let mut inner = self.lock();
        if inner.generation != generation {
            return None;
        }
        let exempt = matches!(
            command,
            BaseCommand::ClosePage | BaseCommand::ClearPasswordWrong
        );
        if inner.busy && !exempt {
            return None;
        }
        let job = match command {
            BaseCommand::Choose(id) => {
                if !inner.rows.iter().any(|row| row.id.as_ref() == id) {
                    return None;
                }
                begin_attempt(&mut inner, true)
            }
            BaseCommand::Retry => begin_attempt(&mut inner, false),
            BaseCommand::ShowConnections => {
                inner.stage = Stage::Connect;
                inner.busy = false;
                inner.error.clear();
                inner.offline_reason.clear();
                inner.page.clear();
                None
            }
            BaseCommand::OpenPage(page) => {
                inner.page = page;
                inner.stage = Stage::Page;
                None
            }
            BaseCommand::ClosePage => {
                inner.page.clear();
                inner.stage = Stage::Connect;
                None
            }
            BaseCommand::ClearPasswordWrong | BaseCommand::Nop => None,
        };
        self.publish(&inner);
        job
    }

    /// The lost-connection banner asked to dial again. This is not a
    /// template click. `chosen` on the job is `false`.
    pub fn start_reconnect(&self) -> HostJob {
        let mut inner = self.lock();
        let job = begin_attempt(&mut inner, false).expect("generation advances");
        self.publish(&inner);
        job
    }

    pub fn note_connected(&self, attempt: u64) {
        self.finish(attempt, Stage::Session, "", "");
    }

    pub fn note_unreachable(&self, attempt: u64) {
        self.finish(attempt, Stage::Offline, "", UNREACHABLE);
    }

    pub fn note_refused(&self, attempt: u64, reason: &str) -> bool {
        self.finish(attempt, Stage::Connect, reason, "")
    }

    pub fn note_locked(&self, attempt: u64, sentence: &str) {
        self.finish(attempt, Stage::Connect, sentence, "");
    }

    /// The flow already handed the connection to the window, so the attempt
    /// id is spent. A later refusal of that same session — the launcher
    /// removed the grant — still returns the screen to connect.
    /// A refusal while no session is open does nothing.
    pub fn note_adopted_refusal(&self, reason: &str) {
        let mut inner = self.lock();
        if inner.stage != Stage::Session {
            return;
        }
        inner.attempt = 0;
        inner.busy = false;
        inner.stage = Stage::Connect;
        inner.error = reason.to_string();
        inner.offline_reason.clear();
        inner.page.clear();
        self.publish(&inner);
    }

    fn finish(&self, attempt: u64, stage: Stage, error: &str, offline: &str) -> bool {
        let mut inner = self.lock();
        if attempt == 0 || inner.attempt != attempt {
            return false;
        }
        // One completion per attempt. A later note for this id does nothing.
        inner.attempt = 0;
        inner.busy = false;
        inner.stage = stage;
        inner.error = error.to_string();
        inner.offline_reason = offline.to_string();
        inner.page.clear();
        self.publish(&inner);
        true
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn publish(&self, inner: &Inner) {
        self.model.publish(snap_value(inner, &self.mark));
    }
}

fn begin_attempt(inner: &mut Inner, chosen: bool) -> Option<HostJob> {
    let next = inner.generation.checked_add(1)?;
    inner.generation = next;
    inner.attempt = next;
    inner.busy = true;
    inner.stage = Stage::HandingOff;
    inner.error.clear();
    inner.offline_reason.clear();
    inner.page.clear();
    inner.chosen = chosen;
    Some(HostJob {
        attempt: next,
        chosen,
    })
}

fn snap_json(inner: &Inner, mark: &str) -> serde_json::Value {
    let connections: Vec<_> = inner
        .rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.id.as_ref(),
                "kind": row.kind.as_ref(),
                "icon": row.icon.as_ref(),
                "label": row.label.as_ref(),
                "detail": row.detail.as_ref(),
                "chosen": false,
            })
        })
        .collect();
    let door = || serde_json::json!({ "open": false, "note": DOOR_NOTE });
    serde_json::json!({
        "stage": inner.stage.as_str(),
        "page": inner.page,
        "hostKind": "desktop",
        "deviceNoun": "computer",
        "brand": { "mark": mark, "name": "Coasys" },
        "identityKnown": false,
        "did": "",
        "didShort": "",
        "unpublished": "",
        "hasIdentity": false,
        "holdsMaster": false,
        "keepsLine": false,
        "blocked": "",
        "doors": { "link": door(), "make": door(), "words": door() },
        "devices": [],
        "executorPhase": "",
        "executorReason": "",
        "executorStopped": false,
        "connections": connections,
        "chosen": inner.chosen,
        "busy": inner.busy,
        "lastOutcome": "",
        "error": inner.error,
        "offlineReason": inner.offline_reason,
        "passwordIsNew": false,
        "passwordWrong": false,
        "passwordEntered": false,
        "passwordConfirmed": false,
    })
}

fn snap_value(inner: &Inner, mark: &str) -> Value {
    Value::from_json(&serde_json::json!({ "$namespace": snap_json(inner, mark) }))
}

struct BaseModel {
    snap: Mutex<Value>,
    revision: AtomicU64,
    invalidators: Mutex<Vec<Invalidator>>,
}

impl BaseModel {
    fn new() -> Self {
        Self {
            snap: Mutex::new(Value::Undefined),
            revision: AtomicU64::new(0),
            invalidators: Mutex::new(Vec::new()),
        }
    }

    fn publish(&self, value: Value) {
        *self.snap.lock().unwrap_or_else(|p| p.into_inner()) = value;
        self.revision.fetch_add(1, Ordering::AcqRel);
        let invalidators = self.invalidators.lock().unwrap_or_else(|p| p.into_inner());
        for invalidator in invalidators.iter() {
            invalidator.invalidate();
        }
    }

    fn current(&self) -> Value {
        self.snap.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn revision(&self) -> u64 {
        self.revision.load(Ordering::Acquire)
    }

    fn subscribe(&self, invalidator: Invalidator) {
        self.invalidators
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push(invalidator);
    }
}

/// Serves `baseStore` to the built-in base mount only.
struct BaseBindings {
    builtin: Arc<str>,
    model: Arc<BaseModel>,
}

impl std::fmt::Debug for BaseBindings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BaseBindings")
            .field("builtin", &self.builtin)
            .field("revision", &self.model.revision())
            .finish()
    }
}

impl DataRevision for BaseBindings {
    fn revision(&self) -> u64 {
        self.model.revision()
    }

    fn subscribe(&self, invalidator: Invalidator) {
        self.model.subscribe(invalidator);
    }
}

impl BindingSource for BaseBindings {
    fn root(&self, name: &str, mount: &MountCx) -> Option<Bound> {
        if name != "baseStore" || !trusted(mount, &self.builtin) {
            return None;
        }
        Some(Bound {
            value: self.model.current(),
            members: None,
            domain: Some(RootDomain::App),
        })
    }

    fn profile(&self, _did: &str, _mount: &MountCx) -> Option<Value> {
        None
    }
}

fn trusted(mount: &MountCx, builtin: &str) -> bool {
    mount.tier >= Tier::App
        && matches!(
            &mount.provenance,
            Provenance::Bundle { bundle, slot: BundleSlot::Base } if bundle.as_ref() == builtin
        )
}
