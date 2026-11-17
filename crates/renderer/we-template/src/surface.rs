//! Surface lifetime (E3c-13): the runtime owns the measure table.
//!
//! A `$surface` node — and every mount root, as the host's boundary —
//! carries [`SurfaceTag`]s a frontend reports content-box widths against.
//! The table lives in the [`crate::Runtime`]: a pass claims its keys, the
//! frame's commit prunes what no pass claimed, and a remount under the
//! same [`SurfaceKey`] mints a fresh generation — so a measurement still
//! in flight from an unmounted frontend dies at apply, the way E3c-4
//! drops a closed ticket's event. Reports arrive through the [`crate::Inbox`]
//! like every between-frames producer; `report` is the only write.
//!
//! What a report changes is `{width, tier}` — `createSurface`'s record
//! (`packages/schema-system/frameworks/solid/src/createSurface.ts`), and
//! the tier is [`we_metrics::tier_for_width`]'s answer, never the
//! frontend's.
use std::collections::{HashMap, HashSet};

use we_expr::MountId;
use we_metrics::{tier_for_width, Breakpoints, SizeTier};

use crate::resolved::NodeId;

/// Which box a surface measures. A template's `$surface` names its node;
/// a mount root's host surface names the mount — two namespaces, so a
/// mount root that is itself a `$surface` holds one tag of each.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum SurfaceKey {
    /// A `$surface` node's box, keyed by its stable [`NodeId`].
    Node(NodeId),
    /// The mount's boundary box — what `--viewport` and the egui window
    /// report; bound as `surface` at the mount root until a `$surface`
    /// shadows it.
    Host(MountId),
}

/// A live surface's address: the key plus the generation of this
/// incarnation. A frontend holds the tag the resolved tree stamped on the
/// node; a report quoting a generation the table no longer holds is a
/// stale measure and is dropped.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SurfaceTag {
    /// Which box.
    pub key: SurfaceKey,
    /// This incarnation's number — minted at claim, bumped every remount.
    pub generation: u64,
}

/// One live surface: the generation that owns it and the last applied
/// measure. Fresh entries start at `createSurface`'s initial
/// `{ width: 0, tier: "base" }`.
#[derive(Debug)]
struct SurfaceEntry {
    generation: u64,
    width: f32,
    tier: SizeTier,
}

/// The runtime's surfaces: what this frame's resolves claimed, what
/// measured, and a revision [`crate::Runtime::dirty`] watches. Public
/// because [`crate::ResolveCx`] names it; only the crate can claim,
/// report or commit — frontends reach it through
/// [`crate::Runtime::report_surface`].
#[derive(Debug, Default)]
pub struct SurfaceTable {
    entries: HashMap<SurfaceKey, SurfaceEntry>,
    /// The keys the pass in flight claimed — `commit` retains exactly
    /// these, so a key whose node left the resolved tree drops here.
    claimed: HashSet<SurfaceKey>,
    /// Generations mint upward forever within the runtime — a remount is
    /// always a new one; reuse is how a stale report could land, so the
    /// counter refuses at `u64::MAX` instead of wrapping.
    next_generation: u64,
    /// Bumped when a report changes `{width, tier}` — the dirty input.
    /// Pruning is not a move: the node that could read the entry is gone.
    revision: u64,
    /// Reports dropped for naming a dead key or a stale generation.
    pub(crate) dropped: u64,
}

impl SurfaceTable {
    /// A new resolve pass starts — the last pass's claims are spent.
    pub(crate) fn begin_pass(&mut self) {
        self.claimed.clear();
    }

    /// `key` resolves this pass: record the claim and answer the tag the
    /// node stamps — an existing entry's generation, or a fresh one at
    /// `createSurface`'s initial for a key the table has not seen (or saw
    /// pruned since).
    pub(crate) fn claim(&mut self, key: SurfaceKey) -> SurfaceTag {
        self.claimed.insert(key.clone());
        let next = &mut self.next_generation;
        let generation = self
            .entries
            .entry(key.clone())
            .or_insert_with(|| {
                // Refuse exhaustion rather than wrap into a generation a
                // stale report could still quote — the ticket counter's
                // rule (Lal F6).
                let generation = *next;
                *next = generation
                    .checked_add(1)
                    .expect("surface generations exhausted");
                SurfaceEntry {
                    generation,
                    width: 0.0,
                    tier: SizeTier::Base,
                }
            })
            .generation;
        SurfaceTag { key, generation }
    }

    /// The measure a resolve binds for `key` — `None` when the key is not
    /// live (only claimed keys resolve, so a resolve always finds it).
    pub(crate) fn measure(&self, key: &SurfaceKey) -> Option<(f32, SizeTier)> {
        self.entries.get(key).map(|e| (e.width, e.tier))
    }

    /// Keep only this pass's claims — a node that left the resolved tree
    /// takes its entry with it. Not a revision move: nothing live can
    /// read the pruned entry, so the drop cannot change the next tree.
    pub(crate) fn commit(&mut self) {
        self.entries.retain(|key, _| self.claimed.contains(key));
    }

    /// A frontend's content-box width for `tag`. Applied reports return
    /// `true`; a tag naming a dead key or an old generation returns
    /// `false` and counts in `dropped` — the report rides the inbox the
    /// same either way, the generation is what spends it.
    ///
    /// `tier_for_width` decides the tier; the quiet case is `width` and
    /// `tier` both unmoved — `createSurface`'s `set` guard, so a steady
    /// measure does not dirty the runtime.
    pub(crate) fn report(&mut self, tag: &SurfaceTag, width: f32) -> bool {
        let Some(entry) = self.entries.get_mut(&tag.key) else {
            self.dropped += 1;
            return false;
        };
        if entry.generation != tag.generation {
            self.dropped += 1;
            return false;
        }
        let tier = tier_for_width(width, &Breakpoints::default());
        if entry.width != width || entry.tier != tier {
            entry.width = width;
            entry.tier = tier;
            self.revision += 1;
        }
        true
    }

    /// The dirty input — moves only when a live surface's record does.
    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    /// Live entries — the frame's claim set after commit.
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }
}

#[cfg(test)]
mod tests {
    use std::panic::{catch_unwind, AssertUnwindSafe};

    use super::*;

    /// The generation counter refuses at `u64::MAX` rather than wrapping
    /// into reuse — a report quoting an ancient generation can never land
    /// on a new incarnation (Lal r2 P3, the tickets' F6 rule).
    #[test]
    fn generations_exhaust_instead_of_wrapping() {
        let mut table = SurfaceTable {
            next_generation: u64::MAX - 1,
            ..SurfaceTable::default()
        };
        let a = table.claim(SurfaceKey::Host("a".into()));
        assert_eq!(a.generation, u64::MAX - 1, "the last generation minted");
        let hit = catch_unwind(AssertUnwindSafe(|| {
            table.claim(SurfaceKey::Host("b".into()))
        }));
        assert!(hit.is_err(), "exhaustion refuses instead of wrapping");
        assert!(
            table.measure(&SurfaceKey::Host("b".into())).is_none(),
            "no entry was minted"
        );
        assert_eq!(table.next_generation, u64::MAX, "the counter never wrapped");
    }
}
