//! [`FakeExecutor`]: the executor that answers from memory — empty by
//! default, or fed the snapshot's `queries` table so `model_query` and
//! `model_subscribe` return the same rows a `SnapshotQuerySource` would.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use indexmap::IndexMap;
use we_expr::Value;

use crate::executor::{
    ClassSel, ClassShape, Executor, ExecutorError, FlowCall, LiveQuery, LiveQueryId, QueryIr,
    Result, SpaceId, Write,
};
use crate::Provenance;

/// An `Executor` with nothing behind it: every call counts itself, reads
/// answer the rows a fixture gave (or empty when it gave none), and a
/// `model_subscribe` opens a real [`LiveQuery`] — a fresh `subscriptionId`,
/// the fixture's rows as the initial result at revision 0 — whose `dispose`
/// lands in [`FakeExecutor::disposed`].
///
/// Writes, commits, flows and `shape` stay `Unsupported` — the offline stage
/// never writes — and with a [`Provenance`] attached each one lands in its
/// dropped-call count, beside the `$invoke` targets nothing replied to.
#[derive(Debug, Default)]
pub struct FakeExecutor {
    invocations: AtomicU64,
    subscriptions: AtomicU64,
    disposed: Mutex<Vec<LiveQueryId>>,
    /// Snapshot `queries` rows by name — the class names a call asks are
    /// looked up here, their rows unioned in `ClassSel` order.
    queries: RwLock<IndexMap<String, Value>>,
    provenance: RwLock<Option<Provenance>>,
}

impl FakeExecutor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed the snapshot's `queries` table. `model_query`/`model_subscribe`
    /// answer the rows of each class name they find, concatenated in ask
    /// order; a name the table does not hold contributes nothing, so a class
    /// with no entry still gets the documented empty list.
    pub fn with_queries(self, queries: IndexMap<String, Value>) -> Self {
        *self.queries.write().unwrap() = queries;
        self
    }

    /// Attach the provenance dropped calls are counted into.
    pub fn with_provenance(self, provenance: Provenance) -> Self {
        *self.provenance.write().unwrap() = Some(provenance);
        self
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

    /// An `Unsupported` call — count it as an invocation and a dropped call.
    fn dropped(&self, what: &str) {
        if let Ok(prov) = self.provenance.read() {
            if let Some(prov) = prov.as_ref() {
                prov.note_dropped(what.to_string());
            }
        }
    }

    /// The rows `class` asks for: every name in `names()` looked up in the
    /// fixture table, concatenated — `Many` is a union read.
    fn rows_for(&self, class: &ClassSel) -> Value {
        let queries = self.queries.read().unwrap();
        let mut rows = Vec::new();
        for name in class.names() {
            if let Some(Value::List(found)) = queries.get(name.as_ref()) {
                rows.extend(found.iter().cloned());
            }
        }
        Value::List(Arc::new(rows))
    }
}

#[async_trait::async_trait(?Send)]
impl Executor for FakeExecutor {
    async fn model_query(&self, _s: &SpaceId, class: ClassSel, _q: &QueryIr) -> Result<Value> {
        self.tick();
        Ok(self.rows_for(&class))
    }

    async fn model_subscribe(
        &self,
        _s: &SpaceId,
        class: ClassSel,
        _q: &QueryIr,
    ) -> Result<LiveQuery> {
        self.tick();
        let n = self.subscriptions.fetch_add(1, Ordering::Relaxed);
        Ok(LiveQuery::new(
            LiveQueryId::new(format!("fake-{n}")),
            self.rows_for(&class),
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
