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

use crate::query::{QueryEvent, SubTicket};
use crate::CallId;

/// What can land between frames. `Completion` is the E3c-1 channel
/// carried over unchanged; `Bindings` is F2's invalidation — the source's
/// revision number is the truth, the arrival only wakes. `Query` is
/// E3c-4's delivery: a source pushed an event on a subscription ticket
/// and the hub applies it — the frame's `commit → drain` for a
/// synchronous answer, `drain_inbox` for one between frames. `Surface`
/// reports (E3c-13) join when their producer does.
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
    /// A query source delivered on a subscription ticket — the hub's,
    /// addressed by the ticket so an event queued before the ticket
    /// closed dies at apply.
    Query {
        /// The subscription `open` minted.
        ticket: SubTicket,
        /// What the source pushed.
        event: QueryEvent,
    },
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
    /// Queue and quiet window under ONE lock (Lal F2): a push's
    /// suppression decision and its empty→non-empty transition are one
    /// critical section, and a window's end decides its leftover wake in
    /// the same section — a producer deciding while a window closes can
    /// never strand its own wake.
    inner: Mutex<Inner>,
    /// The frontend's hook — a no-op until `set_waker` installs one.
    waker: RwLock<Waker>,
    /// Test-only probe invoked where `push` decided and before it
    /// enqueues — a barrier parks a producer in exactly the interleaving
    /// the quiet window can lose (Lal F2), no sleeps needed.
    #[cfg(test)]
    push_probe: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

/// The queue and the window flag guarding it — one critical section.
struct Inner {
    queue: VecDeque<Arrival>,
    /// Set while a frame's `commit → drain` runs: `Query` pushes inside
    /// the window are the frame's own products — the same pass drains
    /// them, so they queue without a wake.
    sync_queries: bool,
}

/// The `commit → drain` quiet window, held as a guard (Lal F4): `Drop`
/// ends it, so an unwound frame cannot leave `Query` pushes silenced,
/// and whatever the drain left queued earns its one wake — on unwind
/// too. A batch already queued when the window ends owes that wake
/// regardless: skipping it leaves the batch stranded behind a non-empty
/// queue every later push stays silent for (Lal N2).
pub(crate) struct SyncQueries<'a> {
    inbox: &'a Inbox,
}

impl Drop for SyncQueries<'_> {
    fn drop(&mut self) {
        if self.inbox.end_sync_queries() {
            self.inbox.wake();
        }
    }
}

impl Default for Inbox {
    fn default() -> Self {
        Self::new()
    }
}

impl Inbox {
    pub(crate) fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                queue: VecDeque::new(),
                sync_queries: false,
            }),
            waker: RwLock::new(Arc::new(|| {})),
            #[cfg(test)]
            push_probe: Mutex::new(None),
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
            .inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .queue
            .is_empty();
        if pending {
            self.wake();
        }
    }

    /// Open a `commit → drain` window: until [`Self::end_sync_queries`],
    /// `Query` pushes queue without waking — the same pass's `drain_queries`
    /// consumes them, and a wake for the frame's own products would report
    /// arrivals the frame already handled.
    pub(crate) fn begin_sync_queries(&self) {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .sync_queries = true;
    }

    /// The quiet window, held as a guard: the drop ends it — leftovers
    /// get their wake, and an unwound frame re-arms pushes either way.
    pub(crate) fn sync_queries(&self) -> SyncQueries<'_> {
        self.begin_sync_queries();
        SyncQueries { inbox: self }
    }

    /// Close the window — `true` when leftovers need the one wake the
    /// window suppressed: anything still queued when it ends (a
    /// non-query arrival pushed mid-window, or a query event that
    /// landed behind the drain). There is no "started empty" exception
    /// (Lal F2): leftovers a window that began over an already-woken
    /// batch still need a wake of their own — that wake went to the
    /// frame already running, not to the event queueing now.
    pub(crate) fn end_sync_queries(&self) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.sync_queries = false;
        !inner.queue.is_empty()
    }

    /// A barrier hook a test installs — invoked inside `push` before the
    /// queue lock: the pause point a lost wake needs (Lal F2).
    #[cfg(test)]
    pub(crate) fn set_probe(&self, probe: Arc<dyn Fn() + Send + Sync>) {
        *self.push_probe.lock().unwrap() = Some(probe);
    }

    /// An arrival: appended, and — when the queue went from empty to
    /// non-empty — the waker called once for the batch. A `Query` pushed
    /// inside a `commit → drain` window queues quietly: the same pass
    /// drains it. The quiet decision and the queue transition are one
    /// critical section — a producer can never decide on a window that
    /// already closed (Lal F2).
    pub(crate) fn push(&self, arrival: Arrival) {
        #[cfg(test)]
        if let Some(probe) = self.push_probe.lock().unwrap().clone() {
            probe();
        }
        let wake = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let quiet = matches!(&arrival, Arrival::Query { .. }) && inner.sync_queries;
            let was_empty = inner.queue.is_empty();
            inner.queue.push_back(arrival);
            was_empty && !quiet
        };
        if wake {
            self.wake();
        }
    }

    /// Everything queued, in arrival order. A push that lands while this
    /// runs goes to the new queue — seen by the next drain, never by both.
    pub(crate) fn drain(&self) -> VecDeque<Arrival> {
        std::mem::take(&mut self.inner.lock().unwrap_or_else(|e| e.into_inner()).queue)
    }

    /// The queued `Query` arrivals, in order — the rest stay queued for
    /// `drain` (a frame's `commit → drain` consumes query events without
    /// eating completions or binding invalidations, which keep their
    /// order for `drain_inbox`). A push landing mid-drain goes to the new
    /// queue and is seen next time.
    pub(crate) fn drain_queries(&self) -> Vec<(SubTicket, QueryEvent)> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut out = Vec::new();
        let mut kept = VecDeque::with_capacity(inner.queue.len());
        for arrival in inner.queue.drain(..) {
            match arrival {
                Arrival::Query { ticket, event } => out.push((ticket, event)),
                other => kept.push_back(other),
            }
        }
        inner.queue = kept;
        out
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

    /// Lal F2: a producer that saw the quiet window, then paused while
    /// the frame drained and closed it, must not suppress the only wake.
    /// The probe parks it between decision and enqueue — deterministic,
    /// no sleeps.
    #[test]
    fn a_push_paused_between_deciding_and_enqueueing_still_wakes() {
        let inbox = Arc::new(Inbox::new());
        let wakes = Arc::new(AtomicUsize::new(0));
        let w = wakes.clone();
        inbox.set_waker(Arc::new(move || {
            w.fetch_add(1, Ordering::SeqCst);
        }));
        inbox.begin_sync_queries();

        let entered = Arc::new(std::sync::Barrier::new(2));
        let released = Arc::new(std::sync::Barrier::new(2));
        let (e2, r2) = (entered.clone(), released.clone());
        inbox.set_probe(Arc::new(move || {
            e2.wait();
            r2.wait();
        }));
        let producer = {
            let inbox = inbox.clone();
            std::thread::spawn(move || {
                inbox.push(Arrival::Query {
                    ticket: SubTicket::test(9),
                    event: QueryEvent::Rows(Arc::new(vec![])),
                });
            })
        };

        entered.wait(); // the producer decided and paused
        assert!(inbox.drain_queries().is_empty());
        assert!(
            !inbox.end_sync_queries(),
            "nothing queued yet — no wake owed"
        );
        released.wait();
        producer.join().unwrap();

        assert_eq!(
            wakes.load(Ordering::SeqCst),
            1,
            "the event that queued behind the window still woke the frontend"
        );
        assert_eq!(inbox.drain_queries().len(), 1);
    }

    /// Lal N2: a batch queued inside the window owes its wake even when
    /// the guard drops mid-unwind — a source's `open` that enqueues and
    /// then panics must not strand it: cleared flag but silent queue
    /// means every later push sees non-empty and never wakes again.
    #[test]
    fn an_unwound_window_still_wakes_for_its_leftovers() {
        use std::panic::{catch_unwind, AssertUnwindSafe};
        let inbox = Arc::new(Inbox::new());
        let wakes = Arc::new(AtomicUsize::new(0));
        let w = wakes.clone();
        inbox.set_waker(Arc::new(move || {
            w.fetch_add(1, Ordering::SeqCst);
        }));
        let hit = catch_unwind(AssertUnwindSafe(|| {
            let _window = inbox.sync_queries();
            inbox.push(Arrival::Query {
                ticket: SubTicket::test(7),
                event: QueryEvent::Rows(Arc::new(vec![])),
            });
            panic!("boom");
        }));
        assert!(hit.is_err(), "the panic propagated through the guard");
        assert_eq!(
            wakes.load(Ordering::SeqCst),
            1,
            "the batch queued before the unwind still earned its wake"
        );
        assert_eq!(inbox.drain_queries().len(), 1, "and it stayed queued");

        // And the flag cleared: a later push wakes on its own batch.
        inbox.push(Arrival::Bindings);
        assert_eq!(wakes.load(Ordering::SeqCst), 2);
    }

    /// Lal F2: a window that began over a non-empty queue still owes a
    /// wake for what its drain left behind — the first batch's wake went
    /// to the frame already running, so a quiet arrival that lands after
    /// the drain must not stay silent.
    #[test]
    fn a_window_started_non_empty_wakes_for_leftovers() {
        let inbox = Inbox::new();
        let wakes = Arc::new(AtomicUsize::new(0));
        let w = wakes.clone();
        inbox.set_waker(Arc::new(move || {
            w.fetch_add(1, Ordering::SeqCst);
        }));
        inbox.push(Arrival::Query {
            ticket: SubTicket::test(1),
            event: QueryEvent::Rows(Arc::new(vec![])),
        });
        assert_eq!(wakes.load(Ordering::SeqCst), 1, "the first batch woke");

        inbox.begin_sync_queries();
        assert_eq!(inbox.drain_queries().len(), 1, "the pass drained it");
        inbox.push(Arrival::Query {
            ticket: SubTicket::test(2),
            event: QueryEvent::Rows(Arc::new(vec![])),
        });
        assert!(
            inbox.end_sync_queries(),
            "the leftover queued behind the drain owes a wake"
        );
        inbox.wake();
        assert_eq!(wakes.load(Ordering::SeqCst), 2);
        assert_eq!(inbox.drain_queries().len(), 1);
    }
}
