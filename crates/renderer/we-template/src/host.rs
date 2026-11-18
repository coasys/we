//! The [`Host`] seam: the domain actions a template asks for, and how their
//! answers come back.
//!
//! Core owns local state and screen state; the host never sees either. It
//! receives a typed [`ActionRequest`] — in E3c-1 only the legacy `$invoke`
//! ([`Action::Invoke`]) — and answers [`Invoked::Done`] or
//! [`Invoked::Pending`]. A pending call settles through its [`Completer`],
//! from any thread, into the session's [`crate::Inbox`]; the runtime drains
//! that inbox and runs the call's lifecycle (`onSuccess`/`onError`/
//! `onFinally`, `invoke.ts`).
//!
//! Core mints the [`CallId`]s. A completion for an unknown or already
//! settled call is ignored and counted ([`crate::Stats::completions_ignored`]);
//! one whose node left the tree — in any frame since the call, even if the
//! same id has mounted again — runs nothing and is counted
//! ([`crate::Stats::completions_dropped`]).
use std::any::Any;
use std::sync::Arc;

/// The mount a node was resolved under — the `id` prefix of its tree
/// (`app`, `space`, `page:<id>`, `boot`, or a single tree's id). Lives in
/// `we-expr` with the rest of the mount identity (E3c-7); re-exported
/// here so `crate::host::MountId` keeps working.
pub use we_expr::MountId;
use we_expr::{SpaceHandle, Tier, Value};

use crate::handler::CallId;
use crate::inbox::{Arrival, Inbox};
use crate::resolved::NodeId;

/// Where an action came from — the node's mount and who that mount is.
/// `tier` and `space` are stamped by core from the mount slot (E3c-7):
/// the schema never writes them, and nothing is filtered by them yet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Origin {
    pub mount: MountId,
    pub node: NodeId,
    /// The mount's stamped tier — the slot's, lowered by `meta.role`.
    pub tier: Tier,
    /// The mount's space — `Some` wherever the mount is about a space.
    pub space: Option<SpaceHandle>,
}

/// A domain action. E3c-1 carries the legacy `$invoke` only: its target and
/// its arguments, evaluated with `event` bound.
#[derive(Clone, Debug)]
pub enum Action {
    Invoke { target: Arc<str>, args: Vec<Value> },
}

/// One action, as the host receives it.
#[derive(Clone, Debug)]
pub struct ActionRequest {
    pub origin: Origin,
    pub action: Action,
    /// Set when the gate issued a base-store permit for this call.
    /// A base-store action with `None` does not run.
    pub permit: Option<crate::gate::ActionPermit>,
}

/// What [`Host::act`] answered.
#[derive(Debug)]
pub enum Invoked {
    /// Settled already — an error is a value here. A legacy `$invoke` runs
    /// no lifecycle on a sync answer (`invoke.ts`: callbacks follow a
    /// Promise only).
    Done(Result<Value, Value>),
    /// The host keeps the [`Completer`] and calls it later.
    Pending,
}

/// The host a session runs domain actions against. Object-safe and
/// `'static`, not `Send`: the session lives on one thread; work elsewhere
/// reports through the `Send` [`Completer`]. `Any` lets a frontend reach its
/// own host's extras (the offline host's dropped-call log) through
/// `Session::host_as`.
///
/// ```
/// use we_expr::Value;
/// use we_template::{ActionRequest, Completer, Host, Invoked};
///
/// struct Echo;
/// impl Host for Echo {
///     fn act(&mut self, _request: ActionRequest, _done: Completer) -> Invoked {
///         Invoked::Done(Ok(Value::Null))
///     }
/// }
/// ```
pub trait Host: Any {
    /// Start a domain action. Called from dispatch and lifecycle chains,
    /// never during resolve. Must not block.
    fn act(&mut self, request: ActionRequest, done: Completer) -> Invoked;
}

/// Core's side of the call ids: mints a [`CallId`] and its [`Completer`]
/// per action. Completers hold the session's [`Inbox`] — what they push
/// lands for the next drain, from whatever thread `complete` ran on.
pub struct CallBook {
    /// The next id to hand out; `None` once `u64::MAX` has been minted.
    next: Option<u64>,
    inbox: Arc<Inbox>,
}

impl CallBook {
    pub(crate) fn new(inbox: Arc<Inbox>) -> Self {
        Self {
            next: Some(0),
            inbox,
        }
    }

    /// The next call's completer — ids count up from 0 and are unique for
    /// the book's life: after `u64::MAX` the book is exhausted and answers
    /// `None` rather than wrapping onto an id an outstanding call may hold.
    pub(crate) fn mint(&mut self) -> Option<Completer> {
        let call = self.next?;
        self.next = call.checked_add(1);
        Some(Completer::new(CallId(call), self.inbox.clone()))
    }
}

/// One per action: settles it — pushes the completion into the session
/// inbox, which wakes the frontend. `Send + Sync` because that is all it
/// does. Completing a call twice (through a clone), or completing one the
/// host already answered `Done`, is ignored by the runtime and counted.
#[derive(Clone)]
pub struct Completer {
    call: CallId,
    inbox: Arc<Inbox>,
}

impl Completer {
    pub(crate) fn new(call: CallId, inbox: Arc<Inbox>) -> Self {
        Self { call, inbox }
    }

    pub fn complete(self, result: Result<Value, Value>) {
        self.inbox.push(Arrival::Completion {
            call: self.call,
            result,
        });
    }

    pub fn call_id(&self) -> CallId {
        self.call
    }
}

impl std::fmt::Debug for Completer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Completer")
            .field("call", &self.call)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_send_sync<T: Send + Sync>() {}

    /// Review P3: the last id is minted once; after it the book is
    /// exhausted and never wraps to reuse an id an outstanding call holds.
    #[test]
    fn call_ids_never_repeat_at_exhaustion() {
        let mut book = CallBook {
            next: Some(u64::MAX - 1),
            inbox: Arc::new(Inbox::new()),
        };
        let ids: Vec<Option<CallId>> = (0..4).map(|_| book.mint().map(|c| c.call_id())).collect();
        assert_eq!(
            ids,
            [
                Some(CallId(u64::MAX - 1)),
                Some(CallId(u64::MAX)),
                None,
                None
            ]
        );
    }

    #[test]
    fn completer_crosses_threads() {
        assert_send_sync::<Completer>();
    }
}
