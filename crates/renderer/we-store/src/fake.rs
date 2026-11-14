//! [`FakeExecutor`]: the executor that answers from memory — empty for now,
//! fed by `fixtures/coasys/fixture.json` once E6 lands.
use std::sync::atomic::{AtomicU64, Ordering};

use we_expr::Value;

use crate::executor::{
    ClassSel, ClassShape, Executor, ExecutorError, FlowCall, LiveQuery, LiveQueryId, QueryIr,
    Result, SpaceId, Write,
};

/// An `Executor` with nothing behind it: every read answers empty, every
/// call counts itself (the debug panel's "calls dropped" counter) and does
/// nothing else. E6 teaches it to answer queries from `fixture.json`.
#[derive(Debug, Default)]
pub struct FakeExecutor {
    invocations: AtomicU64,
}

impl FakeExecutor {
    pub fn new() -> Self {
        Self::default()
    }

    /// How many calls have been made — the "calls dropped" debug counter.
    pub fn invocations(&self) -> u64 {
        self.invocations.load(Ordering::Relaxed)
    }

    fn tick(&self) {
        self.invocations.fetch_add(1, Ordering::Relaxed);
    }
}

#[async_trait::async_trait(?Send)]
impl Executor for FakeExecutor {
    async fn model_query(&self, _s: &SpaceId, _c: ClassSel, _q: &QueryIr) -> Result<Value> {
        self.tick();
        Ok(Value::List(std::sync::Arc::new(vec![])))
    }

    async fn model_subscribe(&self, _s: &SpaceId, _c: ClassSel, _q: &QueryIr) -> Result<LiveQuery> {
        self.tick();
        Ok(LiveQuery::new(LiveQueryId(0)))
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
