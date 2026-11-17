//! How much work layout did on this thread — a test asks how many styles
//! a frame resolved, or how many passes it built, rather than timing it.
//!
//! Thread-local, so tests running side by side count only their own
//! frames; a frame runs on one thread. Reading costs nothing worth
//! measuring and nothing reads them in a normal run.
use std::cell::Cell;

thread_local! {
    static STYLE_RESOLVES: Cell<u64> = const { Cell::new(0) };
    static LAYOUT_PASSES: Cell<u64> = const { Cell::new(0) };
}

/// What [`take`] read and reset.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Counters {
    /// [`crate::defaults::style_of`] calls — each one resolves a node's
    /// whole style bag against the token table.
    pub style_resolves: u64,
    /// Taffy builds — one per deferred-base pass, per lane-clamp round.
    pub layout_passes: u64,
}

/// The counts since the last call on this thread, reset to zero.
pub fn take() -> Counters {
    Counters {
        style_resolves: STYLE_RESOLVES.with(|c| c.replace(0)),
        layout_passes: LAYOUT_PASSES.with(|c| c.replace(0)),
    }
}

pub(crate) fn style_resolved() {
    STYLE_RESOLVES.with(|c| c.set(c.get() + 1));
}

pub(crate) fn pass_built() {
    LAYOUT_PASSES.with(|c| c.set(c.get() + 1));
}
