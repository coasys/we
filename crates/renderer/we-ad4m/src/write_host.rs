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

/// Whether this window may write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    ReadOnly,
    Write,
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
        }
    }

    /// The write rows this build ships (`data/storemap-writes.json`).
    pub fn bundled_rows() -> WriteRows {
        WriteRows::from_map(&StoreMap::parse(ROWS).expect("storemap-writes.json parses"))
    }

    pub fn access(&self) -> Access {
        self.access
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
            pending
                .done
                .complete(Err(err_value("cancelled", 0, "Cancelled.")));
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
        let Some(row) = self.rows.get(target) else {
            return self.fallback.act(request, done);
        };
        if self.access == Access::ReadOnly {
            self.notices.push(format!(
                "This window is read-only. Start it with --write --space {} to make changes.",
                self.space.as_str()
            ));
            self.wake();
            return Invoked::Done(Err(err_value("read-only", 0, "This window is read-only.")));
        }
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
            Err(msg) => {
                let fail = row
                    .raw
                    .get("fail")
                    .and_then(|f| f.as_str())
                    .unwrap_or(DEFAULT_FAIL);
                self.notices.push(format!("{fail} {msg}"));
                self.wake();
                return Invoked::Done(Err(err_value("plan", 0, &msg)));
            }
        };
        if let Some(confirm) = planned.confirm.clone() {
            let mut slot = lock(&self.confirm);
            if slot.is_some() {
                return Invoked::Done(Err(err_value("busy", 0, "Another confirmation is open.")));
            }
            *slot = Some(PendingConfirm {
                confirm,
                plan: planned,
                done,
            });
            drop(slot);
            self.wake();
            return Invoked::Pending;
        }
        self.run(planned, done);
        Invoked::Pending
    }
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
