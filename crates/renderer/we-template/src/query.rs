//! `$queries` — the compiled descriptor, the subscription key, and the hub
//! a site's claim lives on.
//!
//! A node's `$queries` block declares named row lists. At resolve time each
//! declaration compiles to a [`QueryIr`] (`resolveQueryProp` +
//! `createQuerySignal` in the TS): `entity`/`dataset`/`subscribe`/`when` are
//! resolved for the descriptor itself, everything else lands in `params` and
//! is `deepResolveTokens`'d into the IR's `where`/`order`/`limit`/`offset`/
//! `include`/`select`/`scope`.
//!
//! The hub ([`QueryHub`]) shares one entry per [`QueryKey`] — the full IR,
//! not just the entity (the subscription pool's "keyed by what is asked,
//! never by the object asking") — refcounted by the [`SiteId`]s claiming it
//! each pass. `commit` diffs a pass's claims against the held set and calls
//! [`QuerySource::open`]/[`QuerySource::close`] at the refcount edges; a
//! source answers on the [`QuerySink`], an [`Arrival::Query`](crate::inbox)
//! on the session's inbox.
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use we_expr::{ParseCache, Value};

use crate::resolve::{eval_json, eval_str};
use crate::resolved::Scope;
use crate::scope::StoreBag;
use crate::NodeId;

/// A compiled query — the `$query` descriptor after expressions are resolved
/// (`QueryDescriptor` in `types.ts`, compiled for the backend's query IR).
/// Fields stay raw JSON where the recipe is data.
///
/// Home is `we-template` — the resolver compiles descriptors; `we-data`
/// re-exports this type so the executor signature names the same thing.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QueryIr {
    /// `where` on the wire — `where_` is only the Rust-legal field name.
    /// Without the rename the executor drops every filter.
    #[serde(rename = "where", skip_serializing_if = "Option::is_none")]
    pub where_: Option<Json>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<Json>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include: Option<Json>,
    /// `select`: the fields a row carries; `id` always comes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub select: Option<Vec<String>>,
    /// `scope`: anchor drill-down (`via` / `anchorId` / transitive / direction).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<Json>,
    /// Every other resolved param — `resolveQueryProp` keeps `params`
    /// wholesale; dropping an unrecognized key would let two different
    /// reads collide on one pool cell. Never an authority-bearing name
    /// ([`RESERVED_IR_KEYS`]): the dataset is [`QueryRequest::dataset`], not
    /// a field of the IR.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Json>,
}

/// Param names that could select where a read runs or who it runs as.
/// `extra` is flattened onto the wire, so a param spelled like one of these
/// would reach a source beside the typed [`DatasetSel`]. The compiler gates
/// a query that authors one; a source refuses an IR that carries one
/// ([`QueryIr::reserved_key`]). `dataset` is the descriptor's own key and
/// never lands in `params`; it is listed for the wire.
pub const RESERVED_IR_KEYS: &[&str] = &["dataset", "space", "origin", "authority", "tier"];

impl QueryIr {
    /// The first authority-bearing name this IR carries in `extra`, if any.
    /// A source must refuse such a request rather than interpret it.
    pub fn reserved_key(&self) -> Option<&'static str> {
        RESERVED_IR_KEYS
            .iter()
            .copied()
            .find(|k| self.extra.contains_key(*k))
    }
}

/// The dataset identity a key is made from: today's resolved `dataset`
/// value as an opaque comparable string. E3c-7 replaces the inside with an
/// interned handle without changing this API.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct DatasetHandle(Arc<str>);

impl DatasetHandle {
    pub fn new(id: impl Into<Arc<str>>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Which dataset a request reads — the only dataset selector a request has.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum DatasetSel {
    /// The mount's own space. Until mounts carry a space this keys as the
    /// pull path always keyed a dataset-less read.
    Here,
    /// A dataset the template named (its resolved `dataset`).
    Named(DatasetHandle),
}

/// A compiled `$queries` entry: every field a source needs is a field, and
/// the key is derived from it, never parsed back.
#[derive(Clone, Debug)]
pub struct QueryRequest {
    /// `entityNamesOf`: deduped, blanks dropped.
    pub classes: Arc<[Arc<str>]>,
    /// The entity was written as a list: one merged answer.
    pub union: bool,
    /// `subscribe` after evaluation; `false` asks once.
    pub subscribe: bool,
    pub dataset: DatasetSel,
    /// where/order/limit/offset/include/select/scope, operands resolved.
    pub ir: QueryIr,
    /// The `$queries` field name, when there is one. Not part of the key.
    pub name_hint: Option<Arc<str>>,
}

impl QueryRequest {
    /// The pool key: `{e, u, ds, sub, ir}` in that field order. `Here`
    /// resolves to `here` (the mount's space) before hashing; with no mount
    /// space it keys as `null`, exactly as a dataset-less read always keyed,
    /// so a `Named` dataset can never collide with it whatever it is called.
    pub fn key(&self, here: Option<&DatasetHandle>) -> QueryKey {
        let ds = match &self.dataset {
            DatasetSel::Here => here,
            DatasetSel::Named(handle) => Some(handle),
        };
        let mut key_obj = serde_json::Map::new();
        key_obj.insert(
            "e".to_string(),
            Json::Array(
                self.classes
                    .iter()
                    .map(|e| Json::String(e.to_string()))
                    .collect(),
            ),
        );
        key_obj.insert("u".to_string(), Json::Bool(self.union));
        key_obj.insert(
            "ds".to_string(),
            ds.map(|h| Json::String(h.as_str().to_string()))
                .unwrap_or(Json::Null),
        );
        key_obj.insert("sub".to_string(), Json::Bool(self.subscribe));
        key_obj.insert("ir".to_string(), self.ir_json());
        QueryKey(
            serde_json::to_string(&Json::Object(key_obj))
                .unwrap_or_default()
                .into(),
        )
    }

    /// The IR as it goes on the wire.
    pub fn ir_json(&self) -> Json {
        serde_json::to_value(&self.ir).unwrap_or(Json::Null)
    }
}

/// What compiling one `$queries` entry gives.
#[derive(Clone, Debug)]
pub enum Compiled {
    /// Send it.
    Ready(QueryRequest),
    /// Its descriptor read a query slot that has not loaded yet: do not
    /// send. The slot answers like a gated one.
    Provisional(QueryRequest),
    /// `when` false, unresolved entity, unresolved bound, reserved param.
    Gated,
}

/// What a compile evaluates against besides the scope.
pub struct CompileCx<'a> {
    pub bag: &'a StoreBag,
    pub cache: &'a mut ParseCache,
    pub warnings: &'a mut Vec<Arc<str>>,
}

impl CompileCx<'_> {
    /// Whether the slot a compile read through has loaded.
    pub fn slot_loaded(&self, slot: &SlotRef) -> bool {
        slot.loaded()
    }
}

impl<'a> CompileCx<'a> {
    pub fn new(
        bag: &'a StoreBag,
        cache: &'a mut ParseCache,
        warnings: &'a mut Vec<Arc<str>>,
    ) -> Self {
        Self {
            bag,
            cache,
            warnings,
        }
    }
}

/// A query's identity: the entity names, the dataset, `subscribe` and the
/// full IR — the string the pool dedups on. Two nodes asking the same thing
/// share a cell; two that differ anywhere in the IR do not.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct QueryKey(Arc<str>);

impl QueryKey {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A declaration site — whose claim a key is held by, distinct from the
/// question itself. The `node` is the resolved [`NodeId`] the site sits
/// over, so the same declaration inside two `$each` rows, or two mounts of
/// one `$part`, are different claims on what may be the same key.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SiteId {
    /// The resolved id of the node the site belongs to.
    pub node: NodeId,
    /// Which declaration on that node.
    pub slot: SiteSlot,
}

/// Which declaration on a node a site is — the named `$queries` fields are
/// one each; an inline `{"$query"}` in prop position is the prop it asks.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum SiteSlot {
    /// A `$queries` field (`Named("items")` for `items: {entity:…}`). The
    /// field name is also the request's `name_hint`, the handle a
    /// name-keyed snapshot table answers by.
    Named(Arc<str>),
    /// A `{"$query"}` prop (`Prop("rows")` for `rows: {$query:…}`).
    Prop(Arc<str>),
    /// A `$each`'s `items` prop.
    EachItems,
    /// A `$single`'s query prop — reserved for the op when it lands.
    SingleItem,
}

/// One subscription a source holds — minted for a key at its 0→1 refcount
/// edge and stamped on every event its sink pushes, so a late delivery for
/// a closed subscription is recognized as dead and dropped. `Copy`: it is
/// a stamp, not a capability — closing needs the hub's table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SubTicket(u64);

impl SubTicket {
    /// The raw value — for a test asserting tickets are distinct.
    pub fn raw(self) -> u64 {
        self.0
    }
}

/// What a source pushes on a ticket's sink — the TS listener's `onRows` /
/// `onError`: the newest rows, or the failure. `Rows` is a wholesale
/// replace until E3c-5b's reconciliation.
#[derive(Debug, Clone)]
pub enum QueryEvent {
    /// The newest rows — `latest` in the TS entry.
    Rows(Arc<Vec<Value>>),
    /// The read failed — `error` in the TS entry; a settled query, so the
    /// `Loaded` flag reports true on it as WE's does.
    Failed(Value),
}

/// The delivery end a source keeps: `open` hands it the ticket's sink, and
/// pushing a [`QueryEvent`] queues an [`Arrival::Query`](crate::inbox::Arrival)
/// on the session's inbox — the frame's `commit → drain` applies it, same
/// pass for a source that answers inside `open`. `Clone` and `Send + Sync`:
/// a live source delivers from wherever it answers.
#[derive(Clone)]
pub struct QuerySink {
    ticket: SubTicket,
    inbox: Arc<crate::inbox::Inbox>,
}

impl fmt::Debug for QuerySink {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("QuerySink")
            .field("ticket", &self.ticket)
            .finish()
    }
}

impl QuerySink {
    /// Push an event on this ticket. A closed ticket's events are dropped
    /// at apply — the sink need not check first.
    pub fn deliver(&self, event: QueryEvent) {
        self.inbox.push(crate::inbox::Arrival::Query {
            ticket: self.ticket,
            event,
        });
    }

    /// The ticket this sink answers.
    pub fn ticket(&self) -> SubTicket {
        self.ticket
    }
}

/// Where a subscription's rows come from — the contract E3c-4 defines and
/// E6/E7's live sources implement. `open` starts a subscription for the
/// full [`QueryRequest`] (entity names, union, dataset, `subscribe`, and
/// the IR — never parsed back from a key) and hands the source the
/// [`QuerySink`] it delivers on; `close` disposes the subscription for a
/// key whose last claim released. A source that never delivers leaves the
/// entry loading, exactly as an unanswered TS `subscribe` does.
///
/// `open` must not re-enter the hub or a source calling it may deadlock;
/// deliver through the sink, which only queues.
pub trait QuerySource: Send + Sync {
    /// Open a subscription for `request` as `ticket`. A synchronous source
    /// delivers inside this call; a live one keeps the sink.
    fn open(&self, ticket: SubTicket, request: &QueryRequest, sink: QuerySink);
    /// Dispose the subscription — every claim on it is gone.
    fn close(&self, ticket: SubTicket);
}

/// One `[]` for every unanswered query. A loading cell's rows are a stable
/// empty list — WE's `[]` initial keeps its allocation until rows land —
/// where a fresh `[]` per read would look like a dependency that always
/// moves to a tracked `initial`.
pub(crate) fn empty_rows() -> Arc<Vec<Value>> {
    static EMPTY: std::sync::OnceLock<Arc<Vec<Value>>> = std::sync::OnceLock::new();
    EMPTY.get_or_init(|| Arc::new(Vec::new())).clone()
}

/// What a claim hands back and a [`QuerySlot`] holds: the entry's current
/// answer — the rows (the shared `[]` while loading), whether it settled
/// (rows or an error — both report loaded, as WE's `loaded` does), and the
/// failure.
#[derive(Debug, Clone)]
pub struct SlotView {
    /// The rows, or the shared empty list while loading.
    pub rows: Arc<Vec<Value>>,
    /// Rows arrived or the read failed — `local.<name>Loaded` reads this.
    pub loaded: bool,
    /// The failure, when the read ended in one.
    pub error: Option<Value>,
}

impl Default for SlotView {
    fn default() -> Self {
        Self {
            rows: empty_rows(),
            loaded: false,
            error: None,
        }
    }
}

/// What a named query compiled to this pass — predeclared into `local`
/// before any query compiles so a sibling's `local.<name>` resolves
/// whichever order the node's queries are compiled in (WE's `forward`
/// accessors, which read the real signal once it exists). `set` writes the
/// view this pass's claim produced; until then the slot answers like a
/// gated one — `[]`, `Loaded` `false`.
#[derive(Debug)]
pub struct QuerySlot(RwLock<SlotView>);

impl Default for QuerySlot {
    fn default() -> Self {
        Self(RwLock::new(SlotView::default()))
    }
}

impl QuerySlot {
    /// Bind the slot to the view this pass's claim answered.
    pub fn set(&self, view: SlotView) {
        if let Ok(mut s) = self.0.write() {
            *s = view;
        }
    }

    /// This pass's claim gated — the slot answers empty again.
    pub fn clear(&self) {
        self.set(SlotView::default());
    }

    /// The view the slot reads as.
    pub fn view(&self) -> SlotView {
        self.0.read().ok().map(|s| s.clone()).unwrap_or_default()
    }

    /// Rows arrived (or an error, reported as loaded).
    pub fn loaded(&self) -> bool {
        self.0.read().map(|s| s.loaded).unwrap_or(false)
    }
}

/// A query slot's identity: the node that declared it and the `$queries`
/// field name. Every value read out of a slot — `local.<q>` rows,
/// `local.<q>Loaded` — and every scope binding derived from one carries it,
/// so "this compile read an unloaded slot" is decided by which slot was read,
/// whatever name or alias the expression used to reach it. Equality and hash
/// are the identity; the slot handle answers whether it has loaded.
#[derive(Clone, Debug)]
pub struct SlotRef {
    pub node: NodeId,
    pub name: Arc<str>,
    slot: Arc<QuerySlot>,
}

impl SlotRef {
    pub fn new(node: NodeId, name: Arc<str>, slot: Arc<QuerySlot>) -> Self {
        Self { node, name, slot }
    }

    /// The slot's claim settled — rows arrived or the read failed (WE's
    /// `loaded` reports both).
    pub fn loaded(&self) -> bool {
        self.slot.loaded()
    }
}

impl PartialEq for SlotRef {
    fn eq(&self, other: &Self) -> bool {
        self.node == other.node && self.name == other.name
    }
}
impl Eq for SlotRef {}
impl std::hash::Hash for SlotRef {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.node.hash(state);
        self.name.hash(state);
    }
}

thread_local! {
    /// The slot reads of the evaluation being observed, innermost observer
    /// on top. `None` when nothing observes.
    static SLOT_READS: RefCell<Option<Vec<SlotRef>>> = const { RefCell::new(None) };
}

/// Record that an evaluation read through `slot`. A no-op unless something
/// is observing ([`observe_slots`]).
pub(crate) fn note_slot_read(slot: &SlotRef) {
    SLOT_READS.with(|reads| {
        if let Some(reads) = reads.borrow_mut().as_mut() {
            if !reads.contains(slot) {
                reads.push(slot.clone());
            }
        }
    });
}

/// Run `f`, returning what it returned and every query slot it read. An
/// enclosing observer sees the same reads.
pub(crate) fn observe_slots<R>(f: impl FnOnce() -> R) -> (R, Vec<SlotRef>) {
    let outer = SLOT_READS.with(|reads| reads.borrow_mut().replace(Vec::new()));
    let out = f();
    let mine = SLOT_READS
        .with(|reads| std::mem::replace(&mut *reads.borrow_mut(), outer))
        .unwrap_or_default();
    for slot in &mine {
        note_slot_read(slot);
    }
    (out, mine)
}

/// One entry's answer state — `latest`/`error`/`failed` on a TS pool
/// entry.
enum CellState {
    /// Subscribed (or claimed, pre-`open`), nothing back yet.
    Loading,
    /// The newest rows.
    Rows(Arc<Vec<Value>>),
    /// The read failed — settled, reported loaded as WE does.
    Failed(Value),
}

/// One held key — the request that opened it, its newest answer, the
/// claims count and the ticket the source knows it by.
struct Entry {
    request: QueryRequest,
    state: CellState,
    /// Sites currently claiming this key. `open` fires at 0→1, `close` at
    /// 1→0; the entry dies with the count.
    holders: usize,
    /// The live subscription — `None` until the first claim commits.
    ticket: Option<SubTicket>,
}

impl Entry {
    fn new(request: QueryRequest) -> Self {
        Self {
            request,
            state: CellState::Loading,
            holders: 0,
            ticket: None,
        }
    }

    /// The answer a claim reports — `latest` when there is one, the shared
    /// empty while loading, `[]` + loaded on a failure.
    fn view(&self) -> SlotView {
        match &self.state {
            CellState::Loading => SlotView::default(),
            CellState::Rows(rows) => SlotView {
                rows: rows.clone(),
                loaded: true,
                error: None,
            },
            CellState::Failed(error) => SlotView {
                rows: empty_rows(),
                loaded: true,
                error: Some(error.clone()),
            },
        }
    }
}

/// What a held entry shows a test or the debug overlay — the pool cell's
/// successor: which request it is, the newest answer, and how many sites
/// hold it.
#[derive(Debug)]
pub struct HubCell {
    /// The full identity — `{e, u, ds, sub, ir}`.
    pub key: QueryKey,
    /// The request the first claim brought (`name_hint` included — the
    /// handle a name-keyed snapshot table answers by).
    pub request: QueryRequest,
    /// Its current answer.
    pub view: SlotView,
    /// The ticket the source opened it under — a test delivers a refill
    /// on it, the way a live subscription's update arrives.
    pub ticket: SubTicket,
    /// The sites claiming it this commit.
    pub holders: usize,
}

/// The subscription hub (E3c-4) — WE's `subscriptionPool` as a lifetime-
/// aware Rust type: one [`Entry`] per held [`QueryKey`], refcounted by the
/// [`SiteId`]s claiming it, with the session's inbox for `onRows`/`onError`.
///
/// - [`Self::claim`] records a site's per-pass claim — a `Ready` compile
///   creates the entry if new and answers its current view; `Provisional`
///   and `Gated` are no claim, so a withheld query never opens a wide
///   subscription.
/// - [`Self::commit`] ends a pass: the claims the pass recorded are diffed
///   against the held set, keys at the 0→1 edge `open` at the source, keys
///   at 1→0 `close`, and a site that moved keys releases then re-acquires —
///   a same-pass release/re-acquire never reaches the source (the claims
///   map holds only the last claim).
/// - [`Self::deliver`] applies one [`QueryEvent`] to its ticket's entry —
///   `Rows` wholesale-replaces; a dead ticket's event is dropped. Bumps the
///   revision on a visible change; [`Self::drain`] does it for everything
///   queued on the inbox — the `commit → drain` the frame runs per pass.
///
/// `Drop` closes every open ticket — a destroyed runtime cannot leak
/// subscriptions.
pub struct QueryHub {
    entries: HashMap<QueryKey, Entry>,
    /// This pass's claims (`SiteId → key`), cleared by each `commit` — a
    /// later claim from the same site replaces the earlier one, so only the
    /// pass's last word counts.
    claims: HashMap<SiteId, QueryKey>,
    /// The held set the last `commit` produced — what this pass's claims
    /// are diffed against.
    held: HashMap<SiteId, QueryKey>,
    /// Live tickets → their key — a delivery addresses the source's
    /// subscription, and a closed ticket's events die here.
    by_ticket: HashMap<SubTicket, QueryKey>,
    next: u64,
    /// Data revision — one of the frame's counters, bumped on every visible
    /// cell change and on the frame loop's leftover-work signal.
    revision: AtomicU64,
    inbox: Arc<crate::inbox::Inbox>,
    /// The source `commit` last ran against — kept so `Drop` can close and
    /// a swap can be told apart.
    source: Option<Arc<dyn QuerySource>>,
}

impl QueryHub {
    pub fn new(inbox: Arc<crate::inbox::Inbox>) -> Self {
        Self {
            entries: HashMap::new(),
            claims: HashMap::new(),
            held: HashMap::new(),
            by_ticket: HashMap::new(),
            next: 0,
            revision: AtomicU64::new(0),
            inbox,
            source: None,
        }
    }

    /// A site's per-pass claim: `site → key`. `Ready` records the claim,
    /// keys the request (`Here` resolves to `here`), stamps the `name_hint`
    /// a `Named` site carries, creates the entry on first sight and answers
    /// its current view — `Loading` until `commit` opens it and a delivery
    /// lands. `Provisional` and `Gated` are a release: any earlier claim
    /// this pass is forgotten and the answer is the empty view — a withheld
    /// compile must never widen into a subscription.
    pub fn claim(
        &mut self,
        site: SiteId,
        compiled: Compiled,
        here: Option<&DatasetHandle>,
    ) -> SlotView {
        match compiled {
            Compiled::Ready(mut request) => {
                if let SiteSlot::Named(name) = &site.slot {
                    request.name_hint = Some(name.clone());
                }
                let key = request.key(here);
                self.claims.insert(site, key.clone());
                self.entries
                    .entry(key)
                    .or_insert_with(|| Entry::new(request))
                    .view()
            }
            Compiled::Provisional(_) | Compiled::Gated => {
                self.claims.remove(&site);
                SlotView::default()
            }
        }
    }

    /// End a pass: releases first, then acquires — a key two sites swapped
    /// claims on keeps its count through both edges and never flaps. A 1→0
    /// key `close`s at the source and dies; a 0→1 key mints a [`SubTicket`]
    /// and `open`s — the request the first claim brought, the sink that
    /// stamps the ticket. Entries a claim created but no commit ever held
    /// (a site re-claimed elsewhere mid-pass) are swept.
    ///
    /// Installing a different source mid-session closes every open ticket
    /// on the old one and reopens on the new.
    pub fn commit(&mut self, source: Arc<dyn QuerySource>) {
        if self
            .source
            .as_ref()
            .is_some_and(|old| !Arc::ptr_eq(old, &source))
        {
            for (ticket, key) in std::mem::take(&mut self.by_ticket) {
                if let Some(old) = &self.source {
                    old.close(ticket);
                }
                if let Some(entry) = self.entries.get_mut(&key) {
                    entry.ticket = None;
                }
            }
        }
        self.source = Some(source);

        let want: HashMap<SiteId, QueryKey> = std::mem::take(&mut self.claims);

        let mut releases: Vec<SiteId> = self
            .held
            .iter()
            .filter(|(site, key)| want.get(*site) != Some(*key))
            .map(|(site, _)| site.clone())
            .collect();
        releases.sort();
        for site in releases {
            if let Some(key) = self.held.remove(&site) {
                self.release_key(&key);
            }
        }

        let mut acquires: Vec<(SiteId, QueryKey)> = want
            .into_iter()
            .filter(|(site, key)| self.held.get(site) != Some(key))
            .collect();
        acquires.sort_by(|a, b| a.0.cmp(&b.0));
        for (site, key) in acquires {
            self.held.insert(site, key.clone());
            self.acquire_key(&key);
        }

        // An entry a claim created but nothing holds — a compile that went
        // provisional between rounds, say — has no reason to exist.
        self.entries
            .retain(|_, e| e.holders > 0 || e.ticket.is_some());
    }

    /// One claim on `key` let go — a holder reached 0: `close` the
    /// subscription and drop the entry.
    fn release_key(&mut self, key: &QueryKey) {
        let Some(entry) = self.entries.get_mut(key) else {
            return;
        };
        entry.holders = entry.holders.saturating_sub(1);
        if entry.holders == 0 {
            if let Some(ticket) = entry.ticket.take() {
                self.by_ticket.remove(&ticket);
                if let Some(source) = &self.source {
                    source.close(ticket);
                }
            }
            self.entries.remove(key);
        }
    }

    /// One claim on `key` arrived — the 0→1 edge mints the ticket and
    /// `open`s at the source: the request, and a sink stamped with the
    /// ticket. The sink only queues, so a source answering inside `open`
    /// is applied by the `drain` this commit's pass follows with.
    fn acquire_key(&mut self, key: &QueryKey) {
        let Some(entry) = self.entries.get_mut(key) else {
            return;
        };
        entry.holders += 1;
        if entry.ticket.is_some() {
            return;
        }
        let ticket = {
            self.next += 1;
            SubTicket(self.next)
        };
        let request = entry.request.clone();
        let sink = QuerySink {
            ticket,
            inbox: self.inbox.clone(),
        };
        if let Some(source) = &self.source {
            source.open(ticket, &request, sink);
        }
        // The entry survives `open` — a source may not claim or commit
        // from inside it (documented on [`QuerySource`]).
        if let Some(entry) = self.entries.get_mut(key) {
            entry.ticket = Some(ticket);
            self.by_ticket.insert(ticket, key.clone());
        }
    }

    /// Apply one event to its ticket's entry — `true` when a cell visibly
    /// changed. A dead ticket's event is dropped (`false`); `Rows` the
    /// entry already holds by allocation is a no-op, and a repeated
    /// `Failed` matching the recorded error is too — but a `Rows`
    /// re-delivery under a different allocation replaces wholesale (E3c-4;
    /// reconciliation is E3c-5b's).
    pub fn deliver(&mut self, ticket: SubTicket, event: QueryEvent) -> bool {
        let Some(key) = self.by_ticket.get(&ticket).cloned() else {
            return false;
        };
        let Some(entry) = self.entries.get_mut(&key) else {
            return false;
        };
        let applied = match (event, &entry.state) {
            (QueryEvent::Rows(rows), CellState::Rows(old)) if Arc::ptr_eq(&rows, old) => false,
            (QueryEvent::Rows(rows), _) => {
                entry.state = CellState::Rows(rows);
                true
            }
            (QueryEvent::Failed(error), CellState::Failed(old))
                if crate::scope::content_eq(&error, old) =>
            {
                false
            }
            (QueryEvent::Failed(error), _) => {
                entry.state = CellState::Failed(error);
                true
            }
        };
        if applied {
            self.revision.fetch_add(1, Ordering::Relaxed);
        }
        applied
    }

    /// Everything the inbox holds for this hub, applied in arrival order —
    /// `true` when any cell moved, meaning a re-resolve may now see rows.
    /// Events for tickets closed since they queued are dropped.
    pub fn drain(&mut self) -> bool {
        let mut moved = false;
        for (ticket, event) in self.inbox.drain_queries() {
            moved |= self.deliver(ticket, event);
        }
        moved
    }

    /// Data revision — one of the frame's counters.
    pub fn revision(&self) -> u64 {
        self.revision.load(Ordering::Relaxed)
    }

    /// A visible change happened outside `deliver` — the frame's
    /// leftover-work marker (its pass budget ran out mid-climb; `dirty`
    /// must still see the work left).
    pub fn bump(&self) {
        self.revision.fetch_add(1, Ordering::Relaxed);
    }

    /// Distinct keys currently held — how many subscriptions the source
    /// should see.
    pub fn held(&self) -> usize {
        self.entries.values().filter(|e| e.holders > 0).count()
    }

    /// Live tickets — subscriptions the source believes it has.
    pub fn opened(&self) -> usize {
        self.by_ticket.len()
    }

    /// Held cells — what the old pool's `len` reported.
    pub fn len(&self) -> usize {
        self.held()
    }

    /// No held cells.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The held cells, ordered by key — what a test or overlay inspects.
    pub fn cells(&self) -> Vec<HubCell> {
        let mut cells: Vec<HubCell> = self
            .entries
            .iter()
            .filter(|(_, e)| e.holders > 0)
            .map(|(key, e)| HubCell {
                key: key.clone(),
                request: e.request.clone(),
                view: e.view(),
                ticket: e.ticket.unwrap_or(SubTicket(0)),
                holders: e.holders,
            })
            .collect();
        cells.sort_by(|a, b| a.key.as_str().cmp(b.key.as_str()));
        cells
    }
}

impl Drop for QueryHub {
    /// A destroyed hub cannot leak subscriptions — every open ticket hears
    /// `close` on the source that opened it.
    fn drop(&mut self) {
        if let Some(source) = &self.source {
            for ticket in self.by_ticket.keys() {
                source.close(*ticket);
            }
        }
    }
}

/// Drop where-conditions whose operands did not resolve
/// (`pruneUnresolvedWhere`): only `Undefined` is unresolved — `null` is a
/// value ("equals null") and stays, an empty `not:` list is no condition and
/// drops, `OR`/`AND`/`NOT` recurse. `None` when nothing survives.
#[doc(hidden)] // public for the conformance vectors
pub fn prune_where(clause: &Value) -> Option<Json> {
    let Value::Obj(map) = clause else {
        return Some(clause.to_json());
    };
    let mut out = serde_json::Map::new();
    for (key, value) in map.iter() {
        if value.is_undefined() {
            continue;
        }
        match &**key {
            "OR" | "AND" => {
                let Value::List(branches) = value else {
                    continue;
                };
                let kept: Vec<Json> = branches
                    .iter()
                    .filter(|b| matches!(b, Value::Obj(_)))
                    .filter_map(prune_where)
                    .collect();
                if !kept.is_empty() {
                    out.insert(key.to_string(), Json::Array(kept));
                }
            }
            "NOT" => {
                if matches!(value, Value::Obj(_)) {
                    if let Some(pruned) = prune_where(value) {
                        out.insert(key.to_string(), pruned);
                    }
                }
            }
            _ => {
                if let Value::Obj(ops) = value {
                    let kept: Vec<(String, Json)> = ops
                        .iter()
                        .filter(|(op, operand)| {
                            if operand.is_undefined() {
                                return false;
                            }
                            // An empty `not: []` list prunes away — it is a
                            // hole the resolution left behind, not a filter.
                            op.as_ref() != "not"
                                || !matches!(operand, Value::List(l) if l.is_empty())
                        })
                        .map(|(op, operand)| (op.to_string(), operand.to_json()))
                        .collect();
                    if !kept.is_empty() {
                        out.insert(key.to_string(), Json::Object(kept.into_iter().collect()));
                    }
                } else {
                    out.insert(key.to_string(), value.to_json());
                }
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(Json::Object(out))
    }
}

/// Whether a resolved `scope` still names an anchor (`scopeIsAnchored`): a
/// LIST of anchors is anchored even when empty; an `anchorId` counts only
/// when it is not undefined/null/"".
#[doc(hidden)] // public for the conformance vectors
pub fn scope_anchored(scope: &Value) -> bool {
    let Value::Obj(map) = scope else {
        return false;
    };
    match map.get("anchorId") {
        Some(Value::List(_)) => true,
        Some(Value::Str(s)) => !s.is_empty(),
        Some(Value::Null) | Some(Value::Undefined) | None => false,
        Some(_) => true,
    }
}

/// The entity names a resolved `entity` asks for (`entityNamesOf`): a name
/// is one entity; a list — even of one, even empty — is a union. Anything
/// else is "not answered yet".
fn entity_names(value: &Value) -> Option<(Vec<Arc<str>>, bool)> {
    match value {
        Value::Str(name) if !name.is_empty() => Some((vec![name.clone()], false)),
        Value::List(items) => {
            let mut seen: Vec<Arc<str>> = Vec::new();
            for item in items.iter() {
                if let Value::Str(name) = item {
                    if !name.is_empty() && !seen.iter().any(|s| s == name) {
                        seen.push(name.clone());
                    }
                }
            }
            Some((seen, true))
        }
        _ => None,
    }
}

/// `Value` into the IR's raw JSON — `Undefined` and callables are absent.
fn to_ir_json(value: &Value) -> Option<Json> {
    match value {
        Value::Undefined | Value::Callable(_) => None,
        other => Some(other.to_json()),
    }
}

/// A JSON subtree with every `{"$":expr}` token evaluated and `undefined`
/// results re-encoded — `resolveQueryProp`'s deep resolve of `params`.
fn deep_resolve_json(
    raw: &Json,
    scope: &Scope,
    bag: &StoreBag,
    cache: &mut ParseCache,
    warnings: &mut Vec<Arc<str>>,
) -> Json {
    match raw {
        Json::Object(map) if map.len() == 1 && map.contains_key("$") => {
            eval_json(raw, scope, bag, cache, warnings).to_json()
        }
        Json::Object(map) => Json::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), deep_resolve_json(v, scope, bag, cache, warnings)))
                .collect(),
        ),
        Json::Array(items) => Json::Array(
            items
                .iter()
                .map(|v| deep_resolve_json(v, scope, bag, cache, warnings))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// `resolveQueryProp`: a `$query` object becomes a descriptor —
/// `{entity, params, subscribe, dataset, include?, when?}`. The named keys
/// carry their authored value through verbatim (`entity` stays a token when
/// it is one — entity resolution happens against the live scope at compile
/// time); every other key is a param and is deep-resolved. Absent `entity`
/// and `dataset` encode `undefined`; `subscribe` defaults `true`.
pub fn query_descriptor(
    query: &Json,
    scope: &Scope,
    bag: &StoreBag,
    cache: &mut ParseCache,
    warnings: &mut Vec<Arc<str>>,
) -> Option<Json> {
    let Json::Object(map) = query else {
        return None;
    };
    let undefined = || {
        let mut m = serde_json::Map::new();
        m.insert("$undefined".to_string(), Json::Bool(true));
        Json::Object(m)
    };
    let mut out = serde_json::Map::new();
    let mut params = serde_json::Map::new();
    for (key, raw) in map {
        match key.as_str() {
            "entity" | "dataset" | "include" | "when" => {
                out.insert(key.clone(), raw.clone());
            }
            "subscribe" => {}
            _ => {
                params.insert(
                    key.clone(),
                    deep_resolve_json(raw, scope, bag, cache, warnings),
                );
            }
        }
    }
    out.entry("entity").or_insert_with(undefined);
    out.entry("dataset").or_insert_with(undefined);
    out.insert("params".to_string(), Json::Object(params));
    out.insert(
        "subscribe".to_string(),
        Json::Bool(match map.get("subscribe") {
            None => true,
            Some(Json::Bool(b)) => *b,
            Some(other) => eval_json(other, scope, bag, cache, warnings).truthy(),
        }),
    );
    Some(Json::Object(out))
}

/// Compile one `$queries` entry against `scope` — [`compile_request`]'s
/// answer by the design's name. The [`Compiled`] is what a site claims
/// ([`QueryHub::claim`]): `Ready` is a claim, `Provisional`/`Gated` are
/// not — the field exists, its rows are `[]` and its `Loaded` flag reads
/// `false`.
pub fn compile_query(query: &Json, scope: &Scope, cx: &mut CompileCx) -> Compiled {
    compile_request(query, scope, cx)
}

/// Compile one `$queries` entry against `scope` into a typed request.
/// `Gated` is the answer a `when`-false, an unresolved entity, or an
/// unresolved bound gives in WE before the first rows land.
///
/// `Provisional` when the compile read a query slot that has not loaded —
/// through `local.<q>`, `local.<q>Loaded`, or any alias bound from them. An
/// operand left unresolved by such a read would widen the query for a frame
/// (`pruneUnresolvedWhere`); not sending it is the one declared change from
/// TS, whose final state is the same. An operand unresolved for any other
/// reason still widens.
pub fn compile_request(query: &Json, scope: &Scope, cx: &mut CompileCx) -> Compiled {
    let (request, reads) =
        observe_slots(|| compile_inner(query, scope, cx.bag, cx.cache, cx.warnings));
    match request {
        Some(request) if reads.iter().any(|slot| !cx.slot_loaded(slot)) => {
            Compiled::Provisional(request)
        }
        Some(request) => Compiled::Ready(request),
        None => Compiled::Gated,
    }
}

fn compile_inner(
    query: &Json,
    scope: &Scope,
    bag: &StoreBag,
    cache: &mut ParseCache,
    warnings: &mut Vec<Arc<str>>,
) -> Option<QueryRequest> {
    let descriptor = query_descriptor(query, scope, bag, cache, warnings)?;
    let Json::Object(map) = &descriptor else {
        return None;
    };

    // `when`: falsy → the query is not asked at all.
    if let Some(when) = map.get("when") {
        let met = eval_json(when, scope, bag, cache, warnings);
        if !met.truthy() {
            return None;
        }
    }

    // `entity` — a name, a list, or an expression answering either.
    let (entities, union) = map
        .get("entity")
        .and_then(|e| entity_names(&eval_json(e, scope, bag, cache, warnings)))?;

    // `params` — the descriptor's resolved params; the IR keeps the keys it
    // models and stows the rest in `extra` so the pool key stays honest.
    let mut ir = QueryIr::default();
    let mut bound_gated = false;
    if let Some(Json::Object(params)) = map.get("params") {
        for (key, raw) in params {
            let authored = !raw.is_null();
            let resolved = eval_json(raw, scope, bag, cache, warnings);
            match key.as_str() {
                "where" => ir.where_ = prune_where(&resolved),
                "order" => ir.order = to_ir_json(&resolved),
                "limit" | "offset" => {
                    // An authored bound that did not resolve gates the read —
                    // `unresolvedBound` waits rather than widening it.
                    let n = match &resolved {
                        Value::Num(n) if *n >= 0.0 => Some(*n as u64),
                        Value::Str(s) => s
                            .parse::<f64>()
                            .ok()
                            .filter(|n| *n >= 0.0)
                            .map(|n| n as u64),
                        _ => None,
                    };
                    match (key.as_str(), n) {
                        ("limit", Some(n)) => ir.limit = Some(n),
                        ("offset", Some(n)) => ir.offset = Some(n),
                        _ => {}
                    }
                    if authored && n.is_none() {
                        bound_gated = true;
                    }
                }
                "scope" => {
                    // An unanchored scope widens instead of gating — the
                    // deliberate asymmetry `scopeIsAnchored` documents.
                    if scope_anchored(&resolved) {
                        ir.scope = to_ir_json(&resolved);
                    }
                }
                "select" => {
                    if let Value::List(items) = &resolved {
                        ir.select = Some(
                            items
                                .iter()
                                .filter_map(|i| match i {
                                    Value::Str(s) => Some(s.to_string()),
                                    _ => None,
                                })
                                .collect(),
                        );
                    }
                }
                other if RESERVED_IR_KEYS.contains(&other) => {
                    let message: Arc<str> = format!(
                        "$query param `{other}` is reserved — a dataset is chosen \
                         with `dataset`; the query is not asked"
                    )
                    .into();
                    if !warnings.iter().any(|w| w == &message) {
                        warnings.push(message);
                    }
                    return None;
                }
                other => {
                    if let Some(v) = to_ir_json(&resolved) {
                        ir.extra.insert(other.to_string(), v);
                    }
                }
            }
        }
    }
    if bound_gated {
        return None;
    }

    if let Some(include) = map.get("include") {
        ir.include = to_ir_json(&eval_json(include, scope, bag, cache, warnings));
    }
    let mut dataset_sel = DatasetSel::Here;
    if let Some(dataset) = map.get("dataset") {
        let resolved = match dataset {
            Json::Object(d) if d.get("$").and_then(|s| s.as_str()).is_some() => eval_str(
                d["$"].as_str().unwrap_or_default(),
                scope,
                bag,
                cache,
                warnings,
            ),
            Json::String(s) => Value::Str(s.as_str().into()),
            other => Value::from_json(other),
        };
        if !matches!(resolved, Value::Undefined | Value::Null) {
            dataset_sel = DatasetSel::Named(DatasetHandle::new(resolved.js_string()));
        }
    }

    let subscribe = match map.get("subscribe") {
        None => true,
        Some(Json::Bool(b)) => *b,
        Some(other) => eval_json(other, scope, bag, cache, warnings).truthy(),
    };

    Some(QueryRequest {
        classes: entities.into(),
        union,
        subscribe,
        dataset: dataset_sel,
        ir,
        name_hint: None,
    })
}
