//! The binding-source revision contract (F2): a source's monotonic
//! revision plus the [`Invalidator`] a session hands it — what a source
//! that can change without any input (a profile arrived, the executor
//! finished booting, another member renamed the space) uses to say so.
//!
//! [`StoreBag`] implements [`DataRevision`] today — the offline path and
//! the E3c-2 in-scope cases (`set_root`, readiness). `BindingSource`
//! (E3c-8a) makes the trait a supertrait; its own implementors get the
//! same contract without `StoreBag` in the loop.
use std::sync::{Arc, Weak};

use crate::inbox::{Arrival, Inbox};

/// A data source's change counter — the general form of what `StoreBag`
/// already had as `version`.
pub trait DataRevision {
    /// Monotonic. Must move whenever any answer the source gives could
    /// differ from the last time it was read — a root replaced, a profile
    /// arrived, readiness changed. Reading it is cheap.
    fn revision(&self) -> u64;

    /// Called once, by the session that resolves against this source. The
    /// source keeps the invalidator and calls it — from any thread —
    /// AFTER it bumps `revision`, so a sleeping frontend wakes and the
    /// next `poll` finds the revision ahead of the recorded one. A source
    /// that forgets is still caught — the number, not the wake, is the
    /// truth — but only when something else polled.
    fn subscribe(&self, invalidator: Invalidator);
}

/// What a [`DataRevision`] source is handed by the session resolving
/// against it: [`Invalidator::invalidate`] pushes an `Arrival::Bindings`
/// into the session's inbox, which calls the frontend's waker.
///
/// A `Weak` on purpose — a session's inbox outlives it only through the
/// completers a host still holds, and a handle whose session is gone lets
/// itself be pruned instead of queueing arrivals nothing drains.
#[derive(Clone)]
pub struct Invalidator(Weak<Inbox>);

impl Invalidator {
    /// Wraps the inbox a session's runtime owns — core makes these, the
    /// source only holds them.
    pub(crate) fn new(inbox: &Arc<Inbox>) -> Self {
        Self(Arc::downgrade(inbox))
    }

    /// Still pointing at a live inbox — a source prunes dead handles as
    /// it notices them.
    pub(crate) fn alive(&self) -> bool {
        self.0.upgrade().is_some()
    }

    /// The source's answers may differ now — queues the arrival and calls
    /// the waker, once per batch like everything else.
    pub fn invalidate(&self) {
        if let Some(inbox) = self.0.upgrade() {
            inbox.push(Arrival::Bindings);
        }
    }
}
