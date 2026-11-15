//! The binding-source revision contract (F2): a source's monotonic
//! revision plus the [`Invalidator`] a session hands it — what a source
//! that can change without any input (a profile arrived, the executor
//! finished booting, another member renamed the space) uses to say so.
//!
//! [`StoreBag`] implements [`DataRevision`] today — the offline path and
//! the E3c-2 in-scope cases (`set_root`, readiness). `BindingSource`
//! (E3c-8a) makes the trait a supertrait; its own implementors get the
//! same contract without `StoreBag` in the loop.
use std::collections::BTreeMap;
use std::sync::{Arc, Weak};

use we_expr::{MountCx, Tier, Value};

use crate::inbox::{Arrival, Inbox};

/// A data source's change counter — the general form of what `StoreBag`
/// already had as `version`. `Debug` is part of the contract so a gated
/// `Roots` view can show which source answers it.
pub trait DataRevision: std::fmt::Debug {
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

    /// Same destination — a source that dedups by inbox (the way
    /// [`crate::StoreBag::set_invalidator`] does) keeps one handle per
    /// session instead of doubling every re-install.
    pub(crate) fn same_inbox(&self, other: &Invalidator) -> bool {
        self.0.ptr_eq(&other.0)
    }

    /// The source's answers may differ now — queues the arrival and calls
    /// the waker, once per batch like everything else.
    pub fn invalidate(&self) {
        if let Some(inbox) = self.0.upgrade() {
            inbox.push(Arrival::Bindings);
        }
    }
}

/// The live root source every read goes through (design 5, F2). A mount
/// never reads a bag directly: it asks the session's `BindingSource` for a
/// [`Bound`] by name — a root the source chose to serve — and the [`Gate`]
/// (gate.rs) is the single choke point that decides whether the asking
/// authority may have it and which of its members it may see.
///
/// `mount` is the asking authority (the frame's `MountCx`), never the
/// template's own claim: the source reads tier/space/provenance off the
/// stamp the runtime made at mount time.
pub trait BindingSource: DataRevision + Send + Sync {
    /// The root `name` as `mount` may have it — `None` when the source has
    /// nothing by that name (absent, not an error). A returned [`Bound`]
    /// may still carry a member filter the gate applies per access.
    fn root(&self, name: &str, mount: &MountCx) -> Option<Bound>;

    /// The profile of `did` as `mount` may read it — the one narrow read
    /// behind `$agent` (`templateSurface.ts`: `profileFor` is host wiring;
    /// the profile itself is `identity`-group state).
    fn profile(&self, did: &str, mount: &MountCx) -> Option<Value>;

    /// Whether the host finished booting — the question the boot screen's
    /// mount asks, kept a source answer (not a `sessionStore` member read)
    /// so the flag lives on the same revision as every other root.
    fn ready(&self) -> bool {
        true
    }

    /// The old store names this source still serves member-filtered while
    /// bundles are unconverted (design 5.4, F3). Each name resolves through
    /// `root` like any other and its `Bound` carries the legacy member
    /// table; a name not listed here is an unknown root and refused.
    fn compat_roots(&self) -> &[Arc<str>] {
        &[]
    }
}

/// One root a [`BindingSource`] serves: the value itself plus, when the
/// root is not uniform authority (`screen`, `legacy`, every compat root),
/// the member table the [`Gate`] consults per member access.
#[derive(Debug, Clone)]
pub struct Bound {
    /// The root value — usually a [`we_expr::Namespace`].
    pub value: Value,
    /// The member table the gate applies to this bound, when the root's
    /// members are not all one tier. `None` means every member rides the
    /// root's own domain — the plain-data case.
    pub members: Option<MemberTiers>,
    /// The domain the source declares for a root [`root_domain`] does not
    /// classify — a host's own data root says `Space` and every tier may
    /// traverse it. `None` leaves classification to the table alone: a
    /// name core knows is always core's answer (a source cannot widen
    /// `app`), and a name neither side classifies is refused.
    pub domain: Option<RootDomain>,
}

/// The member filter a [`Bound`] carries (design 4.6.1's `MemberTiers`,
/// Lal R3): which members are classified and the lowest tier that may read
/// each. Semantics per path segment below the bound root:
///
/// - a classified [`MemberRule::Member`] is served when the asking
///   authority's tier reaches it; everything *below* it is ordinary data,
///   no further filtering (`spaceStore.currentSpace.name` rides
///   `currentSpace`'s grant);
/// - a [`MemberRule::Container`] is a structural namespace whose own
///   members are classified by its table (`legacy`'s store names,
///   `screen.shell`);
/// - a [`MemberRule::DeclaredIds`] is an id→value map whose subkeys are
///   allowed only when the mount declared the id (`screen.panels`/`dialogs`
///   = this template's `meta.panels`/`meta.dialogs`);
/// - a [`MemberRule::DeclaredLanes`] is a list of lane names filtered to
///   the lanes the reading frame may see (`collapsedLanes`);
/// - a member absent from the table is denied — `Undefined`, never a
///   blocked value.
#[derive(Debug, Clone, Default)]
pub struct MemberTiers {
    /// member name → rule. Absent means denied. Shared and immutable: a
    /// table's identity IS its policy identity — the gate keys a served
    /// wrapper by it (Lal F7), so a source that changes a member's tier
    /// builds a new table and the next read is filtered by it, never by a
    /// wrapper cached under the old one.
    pub members: Arc<BTreeMap<Arc<str>, MemberRule>>,
}

impl MemberTiers {
    /// A table from its rules.
    pub fn new(members: BTreeMap<Arc<str>, MemberRule>) -> MemberTiers {
        MemberTiers {
            members: Arc::new(members),
        }
    }

    /// A table from flat `member → minimum tier` rows — the compat-root
    /// form the generated `LEGACY_MEMBER_TIERS` provides.
    pub fn from_rows(rows: &[(&'static str, Tier)]) -> MemberTiers {
        MemberTiers::new(
            rows.iter()
                .map(|(name, tier)| (Arc::from(*name), MemberRule::Member { tier: *tier }))
                .collect(),
        )
    }

    /// The rule `member` is classified by, if any.
    pub fn rule(&self, member: &str) -> Option<&MemberRule> {
        self.members.get(member)
    }

    /// The table's identity — two answers with the same id are the same
    /// policy. Only meaningful while a clone is held (the gate's cached
    /// wrapper holds one, so an id it keys by cannot be reused).
    pub fn id(&self) -> usize {
        Arc::as_ptr(&self.members) as usize
    }
}

/// How one classified member is served.
#[derive(Debug, Clone)]
pub enum MemberRule {
    /// A leaf grant: readable at `tier`, everything below it unfiltered.
    Member {
        /// The lowest tier that may read the member.
        tier: Tier,
    },
    /// A structural container — traversable at `tier`; its members are
    /// classified by `members` (never the unfiltered inner namespace).
    Container {
        /// The lowest tier that may traverse into the container.
        tier: Tier,
        /// The container's own member table.
        members: MemberTiers,
    },
    /// An id→value map filtered to the ids the mount declared
    /// (`meta.panels`/`meta.dialogs`): traversable at `tier`, subkeys
    /// allowed only when declared.
    DeclaredIds {
        /// The lowest tier that may read the map at all.
        tier: Tier,
    },
    /// A list of lane names (`collapsedLanes`) seen through the reading
    /// frame's declared lanes (Lal N2): readable at `tier`, and which
    /// names survive is [`crate::gate::visible_lanes`]'s answer — the one
    /// place the lane policy lives.
    DeclaredLanes {
        /// The lowest tier that may read the list at all.
        tier: Tier,
    },
}

/// Which authority domain a root name belongs to (design 4.6.1's
/// `ROOT_DOMAIN`): what the name *is*, not who may read it — the tier
/// check is the gate's second half.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootDomain {
    /// A space-domain root (`space`) — a space template's own store.
    Space,
    /// An app-domain root (`app`, `me`, `system`) — chrome only.
    App,
    /// The screen root — member-checked per access by [`Gate::screen_read`].
    Screen,
    /// A legacy/compatibility root (`legacy` plus every
    /// [`BindingSource::compat_roots`] name) — member-checked against the
    /// legacy table.
    Compat,
}

/// The v2 root names and their domains (design 4.2's `ROOT_DOMAIN`):
/// `space`, `me` and `system` are the space-readable domain; `app` is
/// the app domain — absent at Space. `screen` and `legacy` are their
/// own entries — their members are filtered, the roots themselves
/// traverse at both tiers.
///
/// `compat` is the set [`BindingSource::compat_roots`] adds — the caller
/// passes it because the source owns the transitional list.
pub fn root_domain(name: &str, compat: &[Arc<str>]) -> Option<RootDomain> {
    match name {
        "space" | "me" | "system" => Some(RootDomain::Space),
        "app" => Some(RootDomain::App),
        "screen" => Some(RootDomain::Screen),
        "legacy" => Some(RootDomain::Compat),
        _ => compat
            .iter()
            .any(|c| c.as_ref() == name)
            .then_some(RootDomain::Compat),
    }
}

/// The source a runtime carries before the session installs one:
/// [`crate::StoreBag`] and the mount's [`crate::RootLayer`] behind the
/// [`BindingSource`] contract.
///
/// **Fail closed by default (Lal F3).** [`BagBindings::new`] declares no
/// domain for a root core's [`root_domain`] does not classify, so a host's
/// own bag roots (`sessionStore`, `accountStore`, …) are refused — and
/// counted — at every tier: a `Runtime` nobody gave a classified source
/// serves `screen` (core's value and core's table) and the v2 names core
/// classifies, nothing else. It answers no profiles and is always ready:
/// core reads no store for either (`we-legacy`'s `LegacyBindings` does).
///
/// [`BagBindings::trusted_unclassified`] is the old behaviour under a name
/// that says what it is: every bag root served as a plain `Space`-domain
/// root, unfiltered. Only tests and offline tools that render a snapshot
/// they built themselves opt in ([`crate::Runtime::trust_unclassified_bag`]);
/// a host never does.
pub struct BagBindings {
    bag: Arc<crate::StoreBag>,
    layer: Arc<crate::scope::RootLayer>,
    /// `true` only through [`Self::trusted_unclassified`].
    trusted: bool,
}

impl BagBindings {
    /// Wrap `bag` + `layer`, fail-closed — the runtime's own construction.
    pub fn new(bag: Arc<crate::StoreBag>, layer: Arc<crate::scope::RootLayer>) -> Self {
        Self {
            bag,
            layer,
            trusted: false,
        }
    }

    /// Wrap `bag` + `layer` and label every unclassified bag root `Space`,
    /// unfiltered — the explicit, trusted mode for tests and tools that
    /// built the bag themselves. Never a host's source.
    pub fn trusted_unclassified(
        bag: Arc<crate::StoreBag>,
        layer: Arc<crate::scope::RootLayer>,
    ) -> Self {
        Self {
            bag,
            layer,
            trusted: true,
        }
    }

    /// The wrapped bag.
    pub fn bag(&self) -> &Arc<crate::StoreBag> {
        &self.bag
    }

    /// Whether this is the trusted-unclassified mode.
    pub fn is_trusted(&self) -> bool {
        self.trusted
    }
}

impl std::fmt::Debug for BagBindings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BagBindings")
            .field("trusted", &self.trusted)
            .finish_non_exhaustive()
    }
}

impl BindingSource for BagBindings {
    fn root(&self, name: &str, _mount: &MountCx) -> Option<Bound> {
        self.layer
            .get(name)
            .or_else(|| self.bag.root(name))
            .map(|value| Bound {
                value,
                members: None,
                // Fail closed: no declared domain — a name core does not
                // classify is refused (and counted) by `Roots::root`.
                domain: self.trusted.then_some(RootDomain::Space),
            })
    }

    /// No profiles: core reads no profile store (Lal F1) — a host that
    /// serves `$agent` profiles does so from its own source
    /// (`we-legacy`'s `LegacyBindings`).
    fn profile(&self, _did: &str, _mount: &MountCx) -> Option<Value> {
        None
    }
}

impl DataRevision for BagBindings {
    fn revision(&self) -> u64 {
        self.bag.version()
    }

    fn subscribe(&self, invalidator: Invalidator) {
        self.bag.set_invalidator(invalidator);
    }
}
