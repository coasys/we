//! Mount identity: who a template is mounted as, and the handles that name
//! spaces and datasets without naming them in a way a template can forge.
//!
//! These are E3c-7's types — *stamping only*. The tier is an authority the
//! host fixes at mount time (`meta.role` may lower it, never raise it);
//! reads and actions are not filtered by it yet — that is E3c-8a/8b's gate.
//! What this module guarantees already:
//!
//! - a [`HandleRef`] exists only because a [`HandleTable`] minted it — there
//!   is no public constructor, so a template cannot build or string one;
//! - a mount carries its [`Tier`], its [`SpaceHandle`] (when it is about a
//!   space) and its [`Provenance`] — the slot, not the schema, decides them.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};

use crate::value::{Namespace, Value};

/// The mount a node was resolved under — the `id` prefix of its tree
/// (`app`, `space`, `page:<id>`, `boot`, or a single tree's id).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MountId(pub Arc<str>);

impl MountId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<Arc<str>> for MountId {
    fn from(id: Arc<str>) -> Self {
        Self(id)
    }
}

impl From<&str> for MountId {
    fn from(id: &str) -> Self {
        Self(id.into())
    }
}

impl From<String> for MountId {
    fn from(id: String) -> Self {
        Self(id.into())
    }
}

/// The capability tier — authority, not a naming convention. Not the
/// responsive size tier, which is `we_metrics::SizeTier`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Tier {
    /// A space template: one space, its data.
    Space,
    /// An app template: runtime, accounts, library, other spaces.
    App,
}

/// Which slot of an accepted bundle a mount came from. `Page`/`Template`
/// carry the piece's id so the provenance names it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BundleSlot {
    /// `bundle.app` — the chrome.
    App,
    /// `bundle.bootScreen` — the sign-in screen.
    Boot,
    /// `bundle.pages[id]`.
    Page(Arc<str>),
    /// `bundle.templates[id]` — a shell or a view.
    Template(Arc<str>),
}

/// Where the mounted schema came from — decided by the host's loader,
/// never by the schema.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Provenance {
    /// A slot of an accepted bundle.
    Bundle { bundle: Arc<str>, slot: BundleSlot },
    /// Synced from a space, installed from the marketplace, or forked in
    /// a space.
    SpaceContent { space: SpaceHandle },
    /// A module's own part or panel.
    Module { module: Arc<str> },
    /// A test or a generic single-tree constructor (`Session::offline`,
    /// `Runtime::new`). Always Space unless the caller passes `Tier::App`
    /// explicitly; `meta.role` is never consulted for it (Lal, tier
    /// soundness).
    Explicit,
}

/// Fixed by the host when a template is mounted — a template cannot
/// change it. Stamped onto every [`crate::Value`] query and action the
/// mount produces.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MountCx {
    /// The mount's id — the prefix of its resolved tree.
    pub mount: MountId,
    /// The tier the slot grants, lowered by `meta.role` at mount time.
    pub tier: Tier,
    /// The space this mount is about. `Some` for every space-tier mount;
    /// an app-tier mount has one while a space is open, `None` on the
    /// landing page.
    pub space: Option<SpaceHandle>,
    /// Where the schema came from.
    pub provenance: Provenance,
}

impl MountCx {
    /// A caller-declared context — tests and the single-tree constructors.
    /// `Tier::Space` and `Provenance::Explicit`: the untrusted default.
    pub fn explicit(mount: impl Into<MountId>) -> Self {
        Self {
            mount: mount.into(),
            tier: Tier::Space,
            space: None,
            provenance: Provenance::Explicit,
        }
    }

    /// [`MountCx::explicit`] at `Tier::App` — the caller said so; nothing
    /// inferred it from authored metadata.
    pub fn explicit_app(mount: impl Into<MountId>) -> Self {
        Self {
            tier: Tier::App,
            ..Self::explicit(mount)
        }
    }

    /// The mount's space, when the host knows it (the route, or the host's
    /// own knowledge of which space a panel belongs to).
    pub fn with_space(mut self, space: SpaceHandle) -> Self {
        self.space = Some(space);
        self
    }
}

/// What a handle names.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HandleKind {
    /// A space (its backing perspective/dataset).
    Space,
    /// A dataset an app-tier mount may name.
    Dataset,
}

impl HandleKind {
    /// How the normal form prints it (`{"$handle": "space"}`).
    pub(crate) fn as_label(self) -> &'static str {
        match self {
            HandleKind::Space => "space",
            HandleKind::Dataset => "dataset",
        }
    }
}

/// One handle-table epoch — minted handle ids count up inside it.
#[derive(Debug)]
struct HandleInner {
    /// Which table minted this — a handle another table made is unknown
    /// here (its id means nothing in this table).
    epoch: u64,
    /// The interned slot: `mint` of one (kind, key) always answers the
    /// same id.
    id: u64,
    kind: HandleKind,
    /// Carried out of its provenance (a callback result, a query row, a
    /// part input — E3c-8a taints them): `==` to every other twin of this
    /// handle, refused wherever the table is asked.
    tainted: bool,
    /// The table-minted original, for a use-site check that asks what a
    /// twin degrades.
    untainted: Weak<HandleInner>,
}

/// An interned handle. Created only by [`HandleTable::mint`] — there is
/// no public constructor, so nothing outside a table can build one.
/// Equality is identity: two wrappings of the same minted handle are `==`,
/// a handle another table made (or a tainted twin of one) is `!=`.
#[derive(Clone)]
pub struct HandleRef(Arc<HandleInner>);

impl HandleRef {
    /// Which kind of thing this names.
    pub fn kind(&self) -> HandleKind {
        self.0.kind
    }

    /// `true` for a tainted twin — refuses at every use site.
    pub fn is_tainted(&self) -> bool {
        self.0.tainted
    }

    /// This handle's tainted twin — `==` to every other twin of this
    /// handle, usable nowhere a table checks. E3c-8a produces these when
    /// a handle crosses a boundary it did not arrive through.
    pub fn tainted(&self) -> HandleRef {
        if self.0.tainted {
            return self.clone();
        }
        HandleRef(Arc::new(HandleInner {
            epoch: self.0.epoch,
            id: self.0.id,
            kind: self.0.kind,
            tainted: true,
            untainted: Arc::downgrade(&self.0),
        }))
    }

    /// The untainted original — `Some(self)` for an untainted handle,
    /// the original the twin degrades for a tainted one, `None` if it is
    /// gone.
    pub fn untainted(&self) -> Option<HandleRef> {
        if !self.0.tainted {
            return Some(self.clone());
        }
        self.0.untainted.upgrade().map(HandleRef)
    }
}

impl PartialEq for HandleRef {
    /// Identity: the same minted slot. A tainted twin is a different
    /// identity from the handle itself; two twins of one handle share an
    /// identity, so a template can compare what it was handed.
    fn eq(&self, other: &Self) -> bool {
        self.0.epoch == other.0.epoch
            && self.0.id == other.0.id
            && self.0.tainted == other.0.tainted
    }
}
impl Eq for HandleRef {}

impl std::hash::Hash for HandleRef {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.0.epoch.hash(state);
        self.0.id.hash(state);
        self.0.tainted.hash(state);
    }
}

impl std::fmt::Debug for HandleRef {
    /// Opaque on purpose: kind and slot, never the host key — a log must
    /// not learn what a handle names.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let taint = if self.0.tainted { ", tainted" } else { "" };
        write!(f, "HandleRef({:?}#{}{})", self.0.kind, self.0.id, taint)
    }
}

/// A space, as core holds it: an interned handle. Core compares and
/// stamps it; only a [`HandleTable`] can make one.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SpaceHandle(HandleRef);

impl SpaceHandle {
    /// The underlying handle.
    pub fn handle(&self) -> &HandleRef {
        &self.0
    }

    /// Wrap a minted handle — `None` for any kind that is not a space.
    pub fn from_handle(handle: HandleRef) -> Option<Self> {
        (handle.kind() == HandleKind::Space).then_some(Self(handle))
    }
}

/// The mint and the way back. The loader gives the session one table,
/// shared by the host and the gate; `clone`d tables are the same table
/// (a [`HandleTable::new`] is a different one — its handles are unknown
/// here).
///
/// Handles are minted here and nowhere else — `HandleRef` has no public
/// constructor, so a template cannot build one:
///
/// ```compile_fail
/// let _ = we_expr::HandleRef::new("preview-coasys");
/// ```
pub struct HandleTable {
    /// This table's identity — handles carry it, so a handle minted
    /// elsewhere is refused by `key` rather than aliasing a slot.
    epoch: u64,
    inner: Arc<Mutex<TableInner>>,
}

#[derive(Debug, Default)]
struct TableInner {
    /// The next slot to hand out.
    next: u64,
    /// `(kind, host key)` → slot, so minting the same thing twice answers
    /// the same handle.
    interned: HashMap<(HandleKind, Arc<str>), u64>,
    /// Slot → the host's own key for it (a perspective uuid, a dataset
    /// path — core never reads it, `key` is the host's way back).
    keys: HashMap<u64, Arc<str>>,
}

/// One counter gives every table its own epoch.
static NEXT_EPOCH: AtomicU64 = AtomicU64::new(1);

/// The next table epoch — `None` once every `u64` is taken, so a new
/// table can never take an epoch a live table already holds. Checked
/// rather than saturating: two tables at `u64::MAX` would alias exactly
/// like a wrap (same slot numbering, `key` answering a foreign handle).
fn next_epoch(counter: &AtomicU64) -> Option<u64> {
    counter
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |e| e.checked_add(1))
        .ok()
}

impl HandleTable {
    pub fn new() -> Self {
        Self {
            epoch: next_epoch(&NEXT_EPOCH).expect("handle table epochs exhausted"),
            inner: Arc::new(Mutex::new(TableInner::default())),
        }
    }

    /// The host's way in. `key` is the host's own identifier (a
    /// perspective uuid); core never reads it. Interned: minting the
    /// same `(kind, key)` again answers the same handle.
    pub fn mint(&self, kind: HandleKind, key: &str) -> HandleRef {
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        };
        let key: Arc<str> = key.into();
        let id = match inner.interned.get(&(kind, key.clone())) {
            Some(id) => *id,
            None => {
                let id = inner.next;
                inner.next = id.checked_add(1).expect("handle ids exhausted");
                inner.interned.insert((kind, key.clone()), id);
                inner.keys.insert(id, key);
                id
            }
        };
        HandleRef(Arc::new(HandleInner {
            epoch: self.epoch,
            id,
            kind,
            tainted: false,
            untainted: Weak::new(),
        }))
    }

    /// A minted [`HandleKind::Space`] as the typed [`SpaceHandle`].
    pub fn mint_space(&self, key: &str) -> SpaceHandle {
        SpaceHandle::from_handle(self.mint(HandleKind::Space, key))
            .expect("mint_space mints a space")
    }

    /// The host's way back — only for a live, untainted handle this
    /// table minted. `None` for a handle it did not, and for a tainted
    /// twin.
    pub fn key(&self, handle: &HandleRef) -> Option<Arc<str>> {
        if handle.0.epoch != self.epoch || handle.0.tainted {
            return None;
        }
        let inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        };
        inner.keys.get(&handle.0.id).cloned()
    }
}

impl Clone for HandleTable {
    /// A clone is the same table — same epoch, same handles.
    fn clone(&self) -> Self {
        Self {
            epoch: self.epoch,
            inner: self.inner.clone(),
        }
    }
}

impl Default for HandleTable {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for HandleTable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HandleTable").finish_non_exhaustive()
    }
}

/// A handle as an expression value: a [`Value::Namespace`] with no
/// members that reports itself through [`Namespace::as_handle`]. A
/// template can hold, compare and pass one; it cannot read, build or
/// stringify it (`${h}` is empty, `count(h)` is 0).
#[derive(Debug)]
struct HandleNs(HandleRef);

impl Namespace for HandleNs {
    fn get(&self, _key: &str) -> Value {
        Value::Undefined
    }

    /// A handle is a value, not a store — `settle` keeps it (the
    /// callback-value precedent), so `==` compares identities rather
    /// than collapsing both sides to `Undefined`.
    fn raw(&self) -> Option<Value> {
        Some(Value::handle(self.0.clone()))
    }

    fn as_handle(&self) -> Option<&HandleRef> {
        Some(&self.0)
    }
}

impl Value {
    /// `handle` as a value — opaque: members are `Undefined`, `==` is the
    /// interned identity, and it prints `{"$handle": "…"}` with no key
    /// and no id.
    pub fn handle(handle: HandleRef) -> Value {
        Value::Namespace(Arc::new(HandleNs(handle)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lal F3: the epoch counter exhausts rather than wraps — past
    /// `u64::MAX` a new table is refused, so a live table's epoch can
    /// never alias a fresh one's (two tables at one epoch share slot
    /// numbering: equal handles, `key` answering foreign handles — the
    /// wall the epoch exists to be). The no-ABA claim is then exact.
    #[test]
    fn table_epochs_never_repeat_at_exhaustion() {
        // `u64::MAX` is never handed out: taking it needs a `MAX + 1`
        // the counter cannot hold, so it is the standing "exhausted"
        // mark — refusal comes one epoch before the wrap, never reuse.
        let counter = AtomicU64::new(u64::MAX - 1);
        assert_eq!(next_epoch(&counter), Some(u64::MAX - 1));
        assert_eq!(next_epoch(&counter), None, "no wrap to epoch 0");
        assert_eq!(next_epoch(&counter), None, "exhaustion is final");
    }
}
