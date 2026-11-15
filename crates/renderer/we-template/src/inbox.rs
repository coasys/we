//! The session's arrival queue and the frontend's wake hook (E3c-2).
//!
//! [`Inbox`] is one queue every between-frames producer pushes into: a
//! host's parked [`crate::Completer`] settling a call from any thread, a
//! binding source's [`crate::Invalidator`] saying its answers may have
//! changed. `Session::poll` drains it; the [`Waker`] is the frontend's
//! "call `poll`" — egui's `request_repaint`, a TUI event-channel send, a
//! test's counter.
//!
//! Wake discipline is once per batch: the push that takes the queue from
//! empty to non-empty calls the waker; pushes into a queue already
//! scheduled do not (the pending drain picks them up together), and a
//! push landing after the drain swapped the queue out calls it again —
//! nothing is lost and nothing loops.
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, RwLock};

use we_expr::Value;

use crate::CallId;

/// What can land between frames. `Completion` is the E3c-1 channel
/// carried over unchanged; `Bindings` is F2's invalidation — the source's
/// revision number is the truth, the arrival only wakes. `Query` events
/// (E3c-4/5a) and `Surface` reports (E3c-13) join when their producers do.
pub(crate) enum Arrival {
    /// A host settled a pending call; the runtime runs its lifecycle.
    Completion {
        /// The call core minted.
        call: CallId,
        /// What the host answered.
        result: Result<Value, Value>,
    },
    /// A binding source invalidated — `Runtime::dirty` re-reads its
    /// revision, so a drained `Bindings` can never hide a moved source.
    Bindings,
}

/// The frontend's "call `poll`" hook — egui repaints, a TUI sends on its
/// event channel, a test counts. Called from whatever thread produced
/// the arrival; must be cheap and must not block.
pub type Waker = Arc<dyn Fn() + Send + Sync>;

/// Everything that arrived since the last drain. `push` is callable from
/// any thread — the producer only queues; the session thread runs the
/// consequences. `drain` swaps the queue out under the lock, so an
/// arrival pushed mid-drain lands in the next queue (and wakes again).
pub struct Inbox {
    queue: Mutex<VecDeque<Arrival>>,
    /// The frontend's hook — a no-op until `set_waker` installs one.
    waker: RwLock<Waker>,
}

impl Default for Inbox {
    fn default() -> Self {
        Self::new()
    }
}

impl Inbox {
    pub(crate) fn new() -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
            waker: RwLock::new(Arc::new(|| {})),
        }
    }

    /// Install the frontend's wake hook — `Session::set_waker` forwards.
    /// Replaces whatever was there; already queued arrivals stay queued
    /// — and still get heard. The install comes first, so a first push
    /// racing it either lands before the queue check below (seen →
    /// woken here) or after (its own empty→non-empty wake reads the new
    /// hook). A batch that woke the OLD hook before this call — the
    /// no-op default, or a hook nobody services anymore — gets one wake
    /// now; the odd redundant wake beats stranding a queued batch.
    pub fn set_waker(&self, waker: Waker) {
        *self.waker.write().unwrap_or_else(|e| e.into_inner()) = waker;
        let pending = !self
            .queue
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_empty();
        if pending {
            self.wake();
        }
    }

    /// An arrival: appended, and — when the queue went from empty to
    /// non-empty — the waker called once for the batch.
    pub(crate) fn push(&self, arrival: Arrival) {
        let was_empty = {
            let mut queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
            let was_empty = queue.is_empty();
            queue.push_back(arrival);
            was_empty
        };
        if was_empty {
            self.wake();
        }
    }

    /// Everything queued, in arrival order. A push that lands while this
    /// runs goes to the new queue — seen by the next drain, never by both.
    pub(crate) fn drain(&self) -> VecDeque<Arrival> {
        std::mem::take(&mut *self.queue.lock().unwrap_or_else(|e| e.into_inner()))
    }

    /// "Call `poll`" without an arrival — a frame that ran out of budget
    /// has nothing queued but still needs the frontend back.
    pub(crate) fn wake(&self) {
        let waker = self.waker.read().unwrap_or_else(|e| e.into_inner()).clone();
        waker();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// The drain swaps the queue out: an arrival pushed while a drain is
    /// in flight lands in the next queue, wakes again, and is drained
    /// once — never half-seen, never twice.
    #[test]
    fn push_during_a_drain_lands_in_the_next_queue_and_wakes() {
        let inbox = Inbox::new();
        let wakes = Arc::new(AtomicUsize::new(0));
        let w = wakes.clone();
        inbox.set_waker(Arc::new(move || {
            w.fetch_add(1, Ordering::SeqCst);
        }));
        inbox.push(Arrival::Bindings);
        inbox.push(Arrival::Bindings);
        assert_eq!(wakes.load(Ordering::SeqCst), 1, "one wake per batch");
        let drained = inbox.drain();
        // A push now — conceptually mid-drain — is the next batch's.
        inbox.push(Arrival::Bindings);
        assert_eq!(wakes.load(Ordering::SeqCst), 2);
        assert_eq!(drained.len(), 2);
        assert_eq!(inbox.drain().len(), 1);
        assert!(inbox.drain().is_empty());
    }

    /// Lal P2-2: installing the hook on a queue that already holds
    /// arrivals must schedule a wake — the batch's empty→non-empty wake
    /// went to the old (default no-op) hook, and every later push sees a
    /// non-empty queue and stays quiet. Without this the new frontend
    /// sleeps while work sits waiting.
    #[test]
    fn set_waker_wakes_when_arrivals_are_queued() {
        let inbox = Inbox::new();
        inbox.push(Arrival::Bindings); // the no-op hook was woken — nobody heard
        let wakes = Arc::new(AtomicUsize::new(0));
        let w = wakes.clone();
        inbox.set_waker(Arc::new(move || {
            w.fetch_add(1, Ordering::SeqCst);
        }));
        assert_eq!(
            wakes.load(Ordering::SeqCst),
            1,
            "installing on a pending batch wakes"
        );
        assert_eq!(
            inbox.drain().len(),
            1,
            "the queued arrival still waits for the drain"
        );
    }

    /// A completed call wakes — the `Completer` path into the inbox.
    #[test]
    fn a_completion_pushes_and_wakes() {
        let inbox = Arc::new(Inbox::new());
        let wakes = Arc::new(AtomicUsize::new(0));
        let w = wakes.clone();
        inbox.set_waker(Arc::new(move || {
            w.fetch_add(1, Ordering::SeqCst);
        }));
        let completer = crate::Completer::new(CallId(0), inbox.clone());
        completer.complete(Ok(Value::Null));
        assert_eq!(wakes.load(Ordering::SeqCst), 1);
        assert_eq!(inbox.drain().len(), 1);
    }
}
