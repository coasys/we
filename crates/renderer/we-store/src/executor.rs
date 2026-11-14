//! [`Executor`]: the boundary between the renderer and whatever holds the
//! data — the contract `we-ad4m` implements and `FakeExecutor` fakes.
use std::fmt;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use we_expr::Value;

/// A space's handle — the perspective it is backed by.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SpaceId(Arc<str>);

impl SpaceId {
    pub fn new(id: impl Into<Arc<str>>) -> Self {
        Self(id.into())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl fmt::Debug for SpaceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SpaceId({})", self.0)
    }
}
impl From<&str> for SpaceId {
    fn from(s: &str) -> Self {
        Self::new(s)
    }
}
impl From<String> for SpaceId {
    fn from(s: String) -> Self {
        Self::new(s)
    }
}

/// The class a model query is about: one entity name, or several for the
/// "ask every entity in the list" form (`entity` in `QueryToken`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClassSel {
    One(Arc<str>),
    Many(Vec<Arc<str>>),
}

impl ClassSel {
    pub fn one(name: impl Into<Arc<str>>) -> Self {
        ClassSel::One(name.into())
    }
    pub fn names(&self) -> &[Arc<str>] {
        match self {
            ClassSel::One(n) => std::slice::from_ref(n),
            ClassSel::Many(ns) => ns,
        }
    }
}

/// A compiled query — the `$query` descriptor after expressions are resolved
/// (`QueryDescriptor` in `types.ts`, compiled for the backend's query IR).
/// Fields stay raw JSON where the recipe is data; task M2's `modelRead` rows
/// and the E6 compiler fill them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QueryIr {
    /// `where` on the wire — `where_` is only the Rust-legal field name.
    /// Without the rename the executor drops every filter.
    #[serde(rename = "where", skip_serializing_if = "Option::is_none")]
    pub where_: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include: Option<serde_json::Value>,
    /// `select`: the fields a row carries; `id` always comes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub select: Option<Vec<String>>,
    /// `scope`: anchor drill-down (`via` / `anchorId` / transitive / direction).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<serde_json::Value>,
    /// Store path to the dataset handle (`dataset` in `QueryToken`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dataset: Option<String>,
}

/// One write the validated write RPC performs (AD4M task A3). The recipe is
/// data — see the `modelWrite`/`command` rows in the store map.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Write {
    pub op: WriteOp,
    /// The write's body: class, id, fields — the recipe's payload.
    pub body: serde_json::Value,
}

/// The verbs of the validated write RPC (`perspective.instance*` in A3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WriteOp {
    Create,
    Update,
    Remove,
    AddToCollection,
    RemoveFromCollection,
}

/// A flow call — `proposeFlowTransition` and friends (the store map's `flow`
/// rows). `name` is the recipe's `call`, `args` its evaluated arguments.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowCall {
    pub name: String,
    pub args: serde_json::Value,
}

/// A class's SHACL shape — what a form is built from (E13). `shape` is the
/// raw shape document; the executor decides its terms (tasks A1, A2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassShape {
    pub class: String,
    pub shape: serde_json::Value,
}

/// A live subscription's ticket — the `subscriptionId` the client picked for
/// `modelSubscribe` ([A-Za-z0-9-], 1–64 chars on the wire) and the one
/// `disposeQuery` takes back.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct LiveQueryId(Arc<str>);

impl LiveQueryId {
    pub fn new(id: impl Into<Arc<str>>) -> Self {
        Self(id.into())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl fmt::Display for LiveQueryId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<&str> for LiveQueryId {
    fn from(s: &str) -> Self {
        Self::new(s)
    }
}
impl From<String> for LiveQueryId {
    fn from(s: String) -> Self {
        Self::new(s)
    }
}

/// A live query's handle — `modelSubscribe`'s reply, `PerspectiveSubscribed`
/// on the wire: the subscription's id, its first result and the revision that
/// result describes. `result()` stays the initial result until E7's update
/// channel lands `query-subscription-update`s through [`LiveQuery::record`];
/// `dispose` ends the subscription through the executor that opened it.
#[derive(Debug)]
pub struct LiveQuery {
    id: LiveQueryId,
    result: Value,
    revision: u64,
}

impl LiveQuery {
    /// `modelSubscribe`'s three fields.
    pub fn new(id: LiveQueryId, result: Value, revision: u64) -> Self {
        Self {
            id,
            result,
            revision,
        }
    }
    /// The `subscriptionId` — `disposeQuery`'s handle.
    pub fn id(&self) -> &LiveQueryId {
        &self.id
    }
    /// The latest result — the initial result until updates land.
    pub fn result(&self) -> &Value {
        &self.result
    }
    /// The revision the latest result describes.
    pub fn revision(&self) -> u64 {
        self.revision
    }
    /// An update or resync resolved to a whole result: record the new
    /// revision and the result it describes. The diff-merge itself is E7's.
    pub fn record(&mut self, result: Value, revision: u64) {
        self.result = result;
        self.revision = revision;
    }
    /// `perspective.disposeQuery {uuid, subscriptionId}`: end the
    /// subscription through the executor that opened it. Consumes the
    /// handle — a disposed query is gone.
    pub async fn dispose(self, space: &SpaceId, executor: &dyn Executor) -> Result<bool> {
        executor.dispose_query(space, &self.id).await
    }
}

/// The executor's error channel.
#[derive(Debug, thiserror::Error)]
pub enum ExecutorError {
    /// The member has no working implementation yet — the `deferred` rows of
    /// the store map read this way before their stage.
    #[error("not wired yet: {0}")]
    Unsupported(String),
    /// The executor answered with an error.
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, ExecutorError>;

/// The executor boundary: every model read, write, flow call and shape fetch
/// the store bag needs. `?Send` — futures may stay on the wasm event thread.
///
/// ```
/// use async_trait::async_trait;
/// use we_store::{ClassSel, Executor, LiveQuery, QueryIr, Result, SpaceId};
/// use we_expr::Value;
///
/// struct MyExecutor;
/// #[async_trait(?Send)]
/// impl Executor for MyExecutor {
///     async fn model_query(&self, _s: &SpaceId, _c: ClassSel, _q: &QueryIr) -> Result<Value> {
///         Ok(Value::Null)
///     }
///     async fn model_subscribe(&self, _s: &SpaceId, _c: ClassSel, _q: &QueryIr) -> Result<LiveQuery> {
///         Ok(LiveQuery::new(we_store::LiveQueryId::new("sub-1"), Value::Null, 0))
///     }
///     async fn dispose_query(&self, _s: &SpaceId, _id: &we_store::LiveQueryId) -> Result<bool> {
///         Ok(true)
///     }
///     async fn write(&self, _s: &SpaceId, _w: we_store::Write) -> Result<Value> { Ok(Value::Null) }
///     async fn commit(&self, _s: &SpaceId, _w: Vec<we_store::Write>) -> Result<()> { Ok(()) }
///     async fn flow(&self, _s: &SpaceId, _c: we_store::FlowCall) -> Result<Value> { Ok(Value::Null) }
///     async fn shape(&self, _s: &SpaceId, _c: &str) -> Result<we_store::ClassShape> {
///         Err(we_store::ExecutorError::Unsupported("shape".into()))
///     }
/// }
/// ```
#[async_trait::async_trait(?Send)]
pub trait Executor {
    async fn model_query(&self, space: &SpaceId, class: ClassSel, query: &QueryIr)
        -> Result<Value>;
    /// `perspective.modelSubscribe` — the reply carries the client's
    /// `subscriptionId`, the initial result and its revision.
    async fn model_subscribe(
        &self,
        space: &SpaceId,
        class: ClassSel,
        query: &QueryIr,
    ) -> Result<LiveQuery>;
    /// `perspective.disposeQuery {uuid, subscriptionId}` — end a live query.
    async fn dispose_query(&self, space: &SpaceId, id: &LiveQueryId) -> Result<bool>;
    /// One validated write.
    async fn write(&self, space: &SpaceId, write: Write) -> Result<Value>;
    /// Several writes as one step — a `command` row.
    async fn commit(&self, space: &SpaceId, writes: Vec<Write>) -> Result<()>;
    async fn flow(&self, space: &SpaceId, call: FlowCall) -> Result<Value>;
    /// A class's shape, for building forms.
    async fn shape(&self, space: &SpaceId, class: &str) -> Result<ClassShape>;
}
