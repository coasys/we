//! [`WriteHost`]: the `$invoke` interpreter of a connected window (E11).
//!
//! A target with a `modelWrite` row (`data/storemap-writes.json`) is
//! planned ([`we_data::writes::plan`]) and sent through the validated write
//! RPC; every other target goes to the [`StaticHost`] it wraps, which drops
//! it and logs it, as before E11.
//!
//! Nothing is drawn optimistically: a write changes the executor, and the
//! change reaches the screen through the live query that reads it, as a
//! write from anywhere else would.
//!
//! - A window without the write grant ([`Access::ReadOnly`]) refuses every
//!   write locally with a notice saying how to allow it.
//! - A destructive row (`confirm`) waits for the person's answer
//!   ([`WriteHost::pending_confirm`], [`WriteHost::answer_confirm`]): the
//!   host confirms every destructive action, whatever the template does.
//! - A refused write leaves a [`Notice`] (the row's `fail` sentence, then
//!   the executor's own message) and settles the call with an error value
//!   `{ message, code, kind, errors? }`, so the template's `onError` runs
//!   with `result.message` as the executor said it.
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use we_data::writes::{plan, Confirm, PlanCx, WritePlan, WriteRows, DEFAULT_FAIL};
use we_data::{ExecutorError, SpaceId, StoreMap};
use we_expr::Value;
use we_template::{Action, ActionRequest, Completer, Host, Invoked, StaticHost, StoreBag};

use crate::connection::Connection;
use crate::executor::Ad4mExecutor;

/// The write rows this build ships.
const ROWS: &str = include_str!("../data/storemap-writes.json");

/// Whether this window may write, and where.
///
/// The grant names one space (`--write --space <uuid>`), and so does this:
/// a window granted `A` that opens `B` writes nothing there, whatever the
/// connection would allow. An operator connection (an executor with no
/// admin credential) holds no scoped token, so this check is the only
/// thing between it and `B`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Access {
    #[default]
    ReadOnly,
    /// Writes in this perspective uuid, and no other.
    Write(SpaceId),
}

impl Access {
    /// Writes granted in `space` (a perspective uuid).
    pub fn write(space: impl Into<std::sync::Arc<str>>) -> Self {
        Access::Write(SpaceId::new(space))
    }

    /// Whether a window with this access may write in `space`.
    pub fn writes(&self, space: &str) -> bool {
        matches!(self, Access::Write(granted) if granted.as_str() == space)
    }

    /// The space the grant names, if any.
    pub fn granted(&self) -> Option<&str> {
        match self {
            Access::ReadOnly => None,
            Access::Write(s) => Some(s.as_str()),
        }
    }

    /// What this access means in `space`: itself where it may write,
    /// read-only anywhere else.
    pub fn in_space(&self, space: &str) -> Access {
        if self.writes(space) {
            self.clone()
        } else {
            Access::ReadOnly
        }
    }
}

/// What a shared space opened for writing is refused with. The connected
/// window also says this when a first edit lands on a shared space: it
/// does not ask for a grant there.
pub const SHARED_WRITE_REFUSED: &str =
    "Writes to a shared space wait for the space's policy check, \
     which this app does not run yet. Open it without --write, or pick a personal space.";

/// The notice a window shows when it cannot write in `space` (a uuid).
pub fn read_only_notice(access: &Access, space: &str) -> String {
    match access.granted() {
        Some(granted) if granted != space => format!(
            "This space is read-only: this window may change only space {granted}. \
             Start it with --write --space {space} to change this one."
        ),
        _ => format!(
            "This window is read-only. Start it with --write --space {space} to make changes."
        ),
    }
}

/// One line the app shows after a write went wrong.
#[derive(Debug, Clone)]
pub struct Notice {
    pub text: String,
    pub at: Instant,
}

/// The notices, shared with the app, which draws and expires them.
#[derive(Debug, Clone, Default)]
pub struct Notices(Arc<Mutex<Vec<Notice>>>);

impl Notices {
    pub fn push(&self, text: String) {
        log::warn!("we-ad4m: {text}");
        self.lock().push(Notice {
            text,
            at: Instant::now(),
        });
    }

    pub fn list(&self) -> Vec<Notice> {
        self.lock().clone()
    }

    pub fn dismiss(&self, index: usize) {
        let mut list = self.lock();
        if index < list.len() {
            list.remove(index);
        }
    }

    /// Drop notices older than `max_age`.
    pub fn expire(&self, max_age: Duration) {
        self.lock().retain(|n| n.at.elapsed() < max_age);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Notice>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// A destructive call waiting for the person's answer.
pub struct PendingConfirm {
    pub confirm: Confirm,
    plan: WritePlan,
    done: Completer,
}

/// Where a pending confirmation waits, shared with the app.
pub type ConfirmSlot = Arc<Mutex<Option<PendingConfirm>>>;

type Wake = Arc<dyn Fn() + Send + Sync>;

pub struct WriteHost {
    /// Everything that is not a write row: answered as before (dropped, logged).
    pub fallback: StaticHost,
    rows: WriteRows,
    executor: Ad4mExecutor,
    conn: Connection,
    /// The perspective uuid.
    space: SpaceId,
    /// Reads `recordStore.displays`.
    bag: Arc<StoreBag>,
    access: Access,
    notices: Notices,
    confirm: ConfirmSlot,
    wake: Option<Wake>,
    /// Set when the open perspective is shared. A watched window then
    /// refuses a write with [`SHARED_WRITE_REFUSED`] instead of asking
    /// for a grant.
    shared: bool,
    /// The first edit of a personal space this window may not change
    /// writes that space's uuid here, once. `None` keeps the old notice
    /// and asks for nothing — the direct live-space tests.
    grant_ask: Option<Arc<Mutex<Option<String>>>>,
}

impl WriteHost {
    pub fn new(
        fallback: StaticHost,
        conn: Connection,
        space: SpaceId,
        bag: Arc<StoreBag>,
        access: Access,
    ) -> Self {
        Self {
            fallback,
            rows: Self::bundled_rows(),
            executor: Ad4mExecutor::new(conn.clone()),
            conn,
            space,
            bag,
            access,
            notices: Notices::default(),
            confirm: Arc::new(Mutex::new(None)),
            wake: None,
            shared: false,
            grant_ask: None,
        }
    }

    /// This perspective is shared, so a write is refused rather than asked
    /// for. Only matters once [`WriteHost::watch_grant`] is set.
    pub fn set_shared(&mut self, shared: bool) {
        self.shared = shared;
    }

    /// Where the first unauthorised edit of a personal space reports the
    /// uuid a write grant should be asked for. The refused invoke is not
    /// retried; the next edit writes, once the window holds the grant.
    pub fn watch_grant(&mut self, slot: Arc<Mutex<Option<String>>>) {
        self.grant_ask = Some(slot);
    }

    /// The check a write row runs before it plans. `true` when this window
    /// may not change the space: a notice is up, and a window that called
    /// [`WriteHost::watch_grant`] has asked for the grant (once).
    pub fn gate_write(&mut self) -> bool {
        if self.access.writes(self.space.as_str()) {
            return false;
        }
        if self.shared && self.grant_ask.is_some() {
            self.notices.push(SHARED_WRITE_REFUSED.to_string());
        } else if self.grant_ask.is_some() {
            let space = self.space.as_str().to_string();
            if let Some(slot) = &self.grant_ask {
                if let Ok(mut g) = slot.lock() {
                    if g.is_none() {
                        *g = Some(space);
                    }
                }
            }
            self.notices.push(
                "This space is read-only until you approve changes to it in the AD4M launcher."
                    .into(),
            );
        } else {
            self.notices
                .push(read_only_notice(&self.access, self.space.as_str()));
        }
        self.wake();
        true
    }

    /// The write rows this build ships (`data/storemap-writes.json`).
    pub fn bundled_rows() -> WriteRows {
        WriteRows::from_map(&StoreMap::parse(ROWS).expect("storemap-writes.json parses"))
    }

    /// The window's grant (which may name another space than this one).
    pub fn access(&self) -> &Access {
        &self.access
    }

    pub fn notices(&self) -> Notices {
        self.notices.clone()
    }

    /// The slot a pending confirmation waits in, for the app to share.
    pub fn confirm_handle(&self) -> ConfirmSlot {
        self.confirm.clone()
    }

    /// The confirmation the app must draw, if any.
    pub fn pending_confirm(&self) -> Option<Confirm> {
        lock(&self.confirm).as_ref().map(|p| p.confirm.clone())
    }

    /// The person answered: `true` runs the writes, `false` cancels.
    pub fn answer_confirm(&mut self, yes: bool) {
        let Some(pending) = lock(&self.confirm).take() else {
            return;
        };
        if yes {
            self.run(pending.plan, pending.done);
        } else {
            pending.done.complete(Err(cancelled()));
        }
    }

    /// Wake the window when a notice or a confirmation appears.
    pub fn set_waker(&mut self, wake: Arc<dyn Fn() + Send + Sync>) {
        self.wake = Some(wake);
    }

    fn wake(&self) {
        if let Some(w) = &self.wake {
            w();
        }
    }

    /// Send the plan's writes in order on the connection's runtime and
    /// settle `done` with the last reply. Stops at the first refusal. Not
    /// atomic: a row with several writes can leave the first ones done —
    /// rows that need one step are `command` rows, which are later.
    fn run(&self, plan: WritePlan, done: Completer) {
        if plan.writes.is_empty() {
            done.complete(Ok(Value::Undefined));
            return;
        }
        let tasks: Vec<_> = plan
            .writes
            .into_iter()
            .map(|w| self.executor.write_task(self.space.clone(), w))
            .collect();
        let fail = plan.fail;
        let notices = self.notices.clone();
        let wake = self.wake.clone();
        self.conn.spawn(async move {
            let mut last = Value::Undefined;
            for task in tasks {
                match task.await {
                    Ok(v) => last = v,
                    Err(e) => {
                        notices.push(format!("{fail} {e}"));
                        if let Some(w) = &wake {
                            w();
                        }
                        return done.complete(Err(error_value(&e)));
                    }
                }
            }
            done.complete(Ok(last));
        });
    }
}

impl Host for WriteHost {
    fn act(&mut self, request: ActionRequest, done: Completer) -> Invoked {
        let Action::Invoke { target, args } = &request.action;
        // A rail click is not an invoke this host accepts.
        // `spaceStore.navigateToSpace` falls through with every other
        // target that has no write row, so a template cannot open a space.
        // `row` borrows `self`, and the gate needs `&mut self`, so the
        // lookup is checked first and repeated after the gate.
        if self.rows.get(target).is_none() {
            return self.fallback.act(request, done);
        }
        if self.gate_write() {
            return refuse(done, err_value("read-only", 0, "This window is read-only."));
        }
        let Some(row) = self.rows.get(target) else {
            return self.fallback.act(request, done);
        };
        let displays = self
            .bag
            .root("recordStore")
            .map(|r| match r {
                Value::Namespace(ns) => ns.get("displays"),
                Value::Obj(o) => o.get("displays").cloned().unwrap_or(Value::Undefined),
                _ => Value::Undefined,
            })
            .unwrap_or(Value::Undefined);
        let planned = match plan(
            row,
            args,
            &PlanCx {
                displays: &displays,
            },
        ) {
            Ok(p) => p,
            Err(e) => {
                let fail = row
                    .raw
                    .get("fail")
                    .and_then(|f| f.as_str())
                    .unwrap_or(DEFAULT_FAIL);
                self.notices.push(format!("{fail} {}", e.message));
                self.wake();
                return refuse(done, err_value(e.kind, 0, &e.message));
            }
        };
        if let Some(confirm) = planned.confirm.clone() {
            // A second question while one is open answers "no" to the
            // first rather than losing either (TS `requestDestructive`):
            // two dialogs cannot both be up, and the first call's
            // `onFinally` must still run.
            let previous = lock(&self.confirm).replace(PendingConfirm {
                confirm,
                plan: planned,
                done,
            });
            if let Some(previous) = previous {
                previous.done.complete(Err(cancelled()));
            }
            self.wake();
            return Invoked::Pending;
        }
        self.run(planned, done);
        Invoked::Pending
    }
}

/// Settle a call the host refused before sending anything — through its
/// [`Completer`], as an executor's refusal is, so `onError` and
/// `onFinally` run. (`Invoked::Done` runs no lifecycle.)
fn refuse(done: Completer, error: Value) -> Invoked {
    done.complete(Err(error));
    Invoked::Pending
}

/// What a cancelled confirmation settles with.
fn cancelled() -> Value {
    err_value("cancelled", 0, "Cancelled.")
}

fn lock(slot: &ConfirmSlot) -> std::sync::MutexGuard<'_, Option<PendingConfirm>> {
    slot.lock().unwrap_or_else(|e| e.into_inner())
}

/// `{ message, code, kind }` — what a template's `onError` reads as
/// `result`.
pub fn err_value(kind: &str, code: i32, message: &str) -> Value {
    Value::from_json(&serde_json::json!({ "message": message, "code": code, "kind": kind }))
}

/// A refused write as `onError`'s `result`: the executor's own message, its
/// code, the `InstanceError`'s `kind`, and its per-property `errors` when
/// the write broke the class's shape (422).
pub fn error_value(e: &ExecutorError) -> Value {
    match e {
        ExecutorError::Rejected {
            code,
            message,
            data,
        } => {
            let kind = data
                .as_ref()
                .and_then(|d| d.get("kind"))
                .and_then(|k| k.as_str())
                .unwrap_or("rejected");
            let mut v = serde_json::json!({ "message": message, "code": code, "kind": kind });
            if let Some(errors) = data.as_ref().and_then(|d| d.get("errors")) {
                v["errors"] = errors.clone();
            }
            Value::from_json(&v)
        }
        ExecutorError::Unsupported(_) => err_value("unsupported", 0, &e.to_string()),
        ExecutorError::Other(_) => err_value("failed", 0, &e.to_string()),
    }
}
