//! [`FakeExecutor`]: the executor that answers from memory — and only what
//! it was taught.
//!
//! A request the fixture cannot answer is refused, not served something
//! else: the snapshot's `queries` table is keyed by the `$queries` field
//! name a template declared, while `model_query` arrives as entity names +
//! IR. Naming the difference is the point — "ClassSel" rows looked up by
//! name would let `SignalType` with no filter inherit the recorded list for
//! `signalTypes { order: name asc }`, and a page the fixture never recorded
//! would come back as the whole table.
//!
//! So the fake learns `request → name` the same way [`SnapshotQuerySource`]
//! does — from pool cells (`note`/`note_pool`), or directly (`teach`). The
//! request key is the pool's own: entity names, union, dataset, `subscribe`
//! and the full IR — so a `model_query` and a `model_subscribe` asking the
//! same question are different requests, as they are in the pool.
//! [`FakeExecutor::for_space`] binds the space the fixture speaks for; a
//! call routed elsewhere, or whose `dataset` names another space than the
//! one it is called on, is refused too.
//!
//! An answered request returns the recorded rows as they stand — a named,
//! already-resolved snapshot result is not filtered a second time (TS does
//! the filtering inside the executor; here the recorder already did).
//! `model_subscribe` opens a real [`LiveQuery`] — a fresh `subscriptionId`,
//! the rows as the initial result at revision 0 — whose `dispose` lands in
//! [`FakeExecutor::disposed`].
//!
//! Writes, commits, flows and `shape` stay `Unsupported` — the offline stage
//! never writes — and with a [`Provenance`] attached each refused call lands
//! in its dropped-call count, beside the `$invoke` targets nothing replied
//! to.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use indexmap::IndexMap;
use serde_json::{Map as JsonMap, Value as Json};
use we_expr::Value;
use we_template::{QueryCell, QueryKey, QueryPool};

use crate::executor::{
    ClassSel, ClassShape, Executor, ExecutorError, FlowCall, LiveQuery, LiveQueryId, QueryIr,
    Result, SpaceId, Write,
};
use crate::{Provenance, RouteCaptures};

/// An `Executor` with nothing behind it: every call counts itself, reads
/// answer the rows a fixture gave for exactly this request (or are refused
/// when it gave none — see the module note), and `model_subscribe` opens a
/// real `LiveQuery` whose `dispose` is recorded.
#[derive(Debug, Default)]
pub struct FakeExecutor {
    invocations: AtomicU64,
    subscriptions: AtomicU64,
    disposed: Mutex<Vec<LiveQueryId>>,
    /// The snapshot's `queries` table — `$queries` field name → the answer
    /// that was recorded under it.
    queries: RwLock<IndexMap<String, Value>>,
    /// Request key → `queries` field name, learned from pool cells or
    /// `teach`. A request that resolves to no name is refused.
    names: RwLock<IndexMap<String, Arc<str>>>,
    /// The space the fixture speaks for. `None` accepts any space; once
    /// bound, a call routed to another space is refused.
    space: RwLock<Option<SpaceId>>,
    /// Set by [`OfflineData`](crate::OfflineData)'s factory: an executor
    /// built for a snapshot answers no model call while unbound — the
    /// deliberately space-agnostic fake is `FakeExecutor::new`, which
    /// never carries the flag.
    require_bound: RwLock<bool>,
    provenance: RwLock<Option<Provenance>>,
    /// A route's captures ([`OfflineData::from_route`](crate::OfflineData::from_route)):
    /// when set, a request is answered by its dataset + request identity
    /// against them, and the name table plays no part.
    captures: RwLock<Option<Arc<RouteCaptures>>>,
}

impl FakeExecutor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed the snapshot's `queries` table — the recorded answers requests
    /// are looked up against once their names are learned.
    pub fn with_queries(self, queries: IndexMap<String, Value>) -> Self {
        *self.queries.write().unwrap() = queries;
        self
    }

    /// Answer from one route's captures, bound by request identity.
    pub fn with_captures(self, captures: Arc<RouteCaptures>) -> Self {
        *self.captures.write().unwrap() = Some(captures);
        self
    }

    /// Attach the provenance refused calls are counted into.
    pub fn with_provenance(self, provenance: Provenance) -> Self {
        *self.provenance.write().unwrap() = Some(provenance);
        self
    }

    /// Declare the space this fake speaks for: requests routed to a
    /// different `SpaceId` — or carrying a `dataset` that disagrees with
    /// the `SpaceId` they arrive on — are refused.
    pub fn for_space(self, space: SpaceId) -> Self {
        *self.space.write().unwrap() = Some(space);
        self
    }

    /// [`OfflineData`](crate::OfflineData)'s factory marks the executor it
    /// hands out: bound to the snapshot's space when the snapshot names
    /// one, refusing model calls until `for_space` binds one when it does
    /// not. `FakeExecutor::new` never carries the flag — an executor built
    /// bare is deliberately space-agnostic.
    pub(crate) fn require_binding(self) -> Self {
        *self.require_bound.write().unwrap() = true;
        self
    }

    /// Learn that `key` — the pool's identity for one resolved request —
    /// is answered by the snapshot query named `name`.
    pub fn note(&self, key: &QueryKey, name: impl Into<Arc<str>>) {
        if let Ok(mut names) = self.names.write() {
            names.insert(key.as_str().to_string(), name.into());
        }
    }

    /// Learn one cell's first declared name.
    pub fn note_cell(&self, cell: &QueryCell) {
        if let Some(name) = cell.first_name() {
            self.note(&cell.key, name);
        }
    }

    /// Learn every named cell a pool holds — call it with `runtime.pool()`
    /// after a resolve, as for [`SnapshotQuerySource::note_pool`].
    pub fn note_pool(&self, pool: &QueryPool) {
        for cell in pool.cells() {
            self.note_cell(&cell);
        }
    }

    /// Teach a binding without a pool cell: the request `(class, subscribe,
    /// ir)` is answered by the snapshot query named `name`. The key is the
    /// pool's own, so a `teach` and a compiled cell naming the same request
    /// are interchangeable.
    pub fn teach(
        &self,
        class: &ClassSel,
        subscribe: bool,
        ir: &QueryIr,
        name: impl Into<Arc<str>>,
    ) {
        if let Ok(mut names) = self.names.write() {
            names.insert(request_key(class, ir, subscribe), name.into());
        }
    }

    /// How many calls have been made — the "calls dropped" debug counter.
    pub fn invocations(&self) -> u64 {
        self.invocations.load(Ordering::Relaxed)
    }

    /// The subscriptions `dispose_query` has ended, in order.
    pub fn disposed(&self) -> Vec<LiveQueryId> {
        self.disposed.lock().unwrap().clone()
    }

    fn tick(&self) {
        self.invocations.fetch_add(1, Ordering::Relaxed);
    }

    /// An unanswered call — count it into the provenance's dropped list.
    fn dropped(&self, what: &str) {
        if let Ok(prov) = self.provenance.read() {
            if let Some(prov) = prov.as_ref() {
                prov.note_dropped(what.to_string());
            }
        }
    }

    /// The shared read path for `model_query` (`subscribe = false`) and
    /// `model_subscribe` (`subscribe = true`) — a one-shot and a
    /// subscription are different requests in the pool's key and here.
    fn answer(
        &self,
        space: &SpaceId,
        class: &ClassSel,
        q: &QueryIr,
        subscribe: bool,
    ) -> Result<Value> {
        let what = || {
            format!(
                "{} {{{}}}",
                if subscribe {
                    "model_subscribe"
                } else {
                    "model_query"
                },
                class.names().join(",")
            )
        };
        // A factory executor must be bound: the snapshot named a space
        // and `for_space` was applied, or the snapshot named none and
        // every call is refused until someone binds one.
        if *self.require_bound.read().unwrap() && self.space.read().unwrap().is_none() {
            self.dropped(&what());
            return Err(ExecutorError::Unsupported(format!(
                "{}: unbound executor — the snapshot names no space; \
                 bind one with for_space",
                what()
            )));
        }
        // The fixture speaks for one space once `for_space` binds it — a
        // call routed elsewhere is refused rather than served that space's
        // rows.
        if let Some(bound) = self.space.read().unwrap().clone() {
            if bound != *space {
                self.dropped(&format!("{} @ {space:?}", &what()));
                return Err(ExecutorError::Unsupported(format!(
                    "{}: fixture speaks for {bound:?}, not {space:?}",
                    what()
                )));
            }
        }
        // A `dataset` the IR already resolved must name the space the call
        // routes to — anything else is an inconsistent request.
        if let Some(dataset) = &q.dataset {
            if dataset != space.as_str() {
                self.dropped(&what());
                return Err(ExecutorError::Unsupported(format!(
                    "{}: dataset {dataset} on {space:?}",
                    what()
                )));
            }
        }
        if let Some(captures) = self.captures.read().unwrap().clone() {
            return match captures.rows_for_request(class, q) {
                Some(rows) => Ok(Value::List(rows)),
                None => {
                    self.dropped(&what());
                    Err(ExecutorError::Unsupported(format!(
                        "{}: route {} recorded no answer for this request",
                        what(),
                        captures.route()
                    )))
                }
            };
        }
        let name = self
            .names
            .read()
            .ok()
            .and_then(|names| names.get(&request_key(class, q, subscribe)).cloned());
        let Some(name) = name else {
            self.dropped(&what());
            return Err(ExecutorError::Unsupported(format!(
                "{}: unlearned request",
                what()
            )));
        };
        match self.queries.read().unwrap().get(name.as_ref()) {
            Some(Value::List(rows)) => Ok(Value::List(rows.clone())),
            Some(Value::Undefined) | None => {
                self.dropped(&format!("{} -> {name}", &what()));
                Err(ExecutorError::Unsupported(format!(
                    "{}: snapshot has no answer for {name:?}",
                    what()
                )))
            }
            // A named scalar is the recorded answer — the same one-row
            // shape `snapshot_rows` gives a cell.
            Some(other) => Ok(Value::List(Arc::new(vec![other.clone()]))),
        }
    }
}

/// The request's pool key — the same `{e, u, ds, sub, ir}` document
/// `compile_query` builds the [`QueryKey`] from, so a request matches the
/// cell that asked it exactly: same entities, same union, same dataset,
/// same `subscribe`, same IR — or it is not the same request.
fn request_key(class: &ClassSel, q: &QueryIr, subscribe: bool) -> String {
    let mut key_obj = JsonMap::new();
    key_obj.insert(
        "e".to_string(),
        Json::Array(
            class
                .names()
                .iter()
                .map(|e| Json::String(e.to_string()))
                .collect(),
        ),
    );
    key_obj.insert(
        "u".to_string(),
        Json::Bool(matches!(class, ClassSel::Many(_))),
    );
    key_obj.insert(
        "ds".to_string(),
        q.dataset.clone().map(Json::String).unwrap_or(Json::Null),
    );
    key_obj.insert("sub".to_string(), Json::Bool(subscribe));
    key_obj.insert(
        "ir".to_string(),
        serde_json::to_value(q).unwrap_or(Json::Null),
    );
    serde_json::to_string(&Json::Object(key_obj)).unwrap_or_default()
}

#[async_trait::async_trait(?Send)]
impl Executor for FakeExecutor {
    /// A one-shot `findAll` — the `subscribe: false` request.
    async fn model_query(&self, space: &SpaceId, class: ClassSel, q: &QueryIr) -> Result<Value> {
        self.tick();
        self.answer(space, &class, q, false)
    }

    /// A subscription — the `subscribe: true` request.
    async fn model_subscribe(
        &self,
        space: &SpaceId,
        class: ClassSel,
        q: &QueryIr,
    ) -> Result<LiveQuery> {
        self.tick();
        let result = self.answer(space, &class, q, true)?;
        let n = self.subscriptions.fetch_add(1, Ordering::Relaxed);
        Ok(LiveQuery::new(
            LiveQueryId::new(format!("fake-{n}")),
            result,
            0,
        ))
    }

    async fn dispose_query(&self, _s: &SpaceId, id: &LiveQueryId) -> Result<bool> {
        self.tick();
        self.disposed.lock().unwrap().push(id.clone());
        Ok(true)
    }

    async fn write(&self, _s: &SpaceId, _w: Write) -> Result<Value> {
        self.tick();
        self.dropped("write");
        Err(ExecutorError::Unsupported("write".into()))
    }

    async fn commit(&self, _s: &SpaceId, _w: Vec<Write>) -> Result<()> {
        self.tick();
        self.dropped("commit");
        Err(ExecutorError::Unsupported("commit".into()))
    }

    async fn flow(&self, _s: &SpaceId, call: FlowCall) -> Result<Value> {
        self.tick();
        self.dropped(&call.name);
        Err(ExecutorError::Unsupported(call.name))
    }

    async fn shape(&self, _s: &SpaceId, class: &str) -> Result<ClassShape> {
        self.tick();
        self.dropped(&format!("shape: {class}"));
        Err(ExecutorError::Unsupported(format!("shape: {class}")))
    }
}
