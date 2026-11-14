//! [`FakeExecutor`]: the executor that answers from memory — empty for now,
//! fed by `fixtures/coasys/fixture.json` once E6 lands.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use we_expr::Value;

use crate::executor::{
    ClassSel, ClassShape, Executor, ExecutorError, FlowCall, LiveQuery, LiveQueryId, QueryIr,
    Result, SpaceId, Write,
};

/// An `Executor` with nothing behind it: every read answers empty, every
/// call counts itself (the debug panel's "calls dropped" counter) and a
/// `model_subscribe` opens a real [`LiveQuery`] — a fresh `subscriptionId`,
/// an empty initial result at revision 0 — whose `dispose` lands in
/// [`FakeExecutor::disposed`]. E6 teaches it to answer queries from
/// `fixture.json`.
#[derive(Debug, Default)]
pub struct FakeExecutor {
    invocations: AtomicU64,
    subscriptions: AtomicU64,
    disposed: Mutex<Vec<LiveQueryId>>,
}

impl FakeExecutor {
    pub fn new() -> Self {
        Self::default()
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
}

#[async_trait::async_trait(?Send)]
impl Executor for FakeExecutor {
    async fn model_query(&self, _s: &SpaceId, _c: ClassSel, _q: &QueryIr) -> Result<Value> {
        self.tick();
        Ok(Value::List(Arc::new(vec![])))
    }

    async fn model_subscribe(&self, _s: &SpaceId, _c: ClassSel, _q: &QueryIr) -> Result<LiveQuery> {
        self.tick();
        let n = self.subscriptions.fetch_add(1, Ordering::Relaxed);
        Ok(LiveQuery::new(
            LiveQueryId::new(format!("fake-{n}")),
            Value::List(Arc::new(vec![])),
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
        Err(ExecutorError::Unsupported("write".into()))
    }

    async fn commit(&self, _s: &SpaceId, _w: Vec<Write>) -> Result<()> {
        self.tick();
        Err(ExecutorError::Unsupported("commit".into()))
    }

    async fn flow(&self, _s: &SpaceId, call: FlowCall) -> Result<Value> {
        self.tick();
        Err(ExecutorError::Unsupported(call.name))
    }

    async fn shape(&self, _s: &SpaceId, class: &str) -> Result<ClassShape> {
        self.tick();
        Err(ExecutorError::Unsupported(format!("shape: {class}")))
    }
}
