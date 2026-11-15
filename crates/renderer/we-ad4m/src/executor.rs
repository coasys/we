//! [`Ad4mExecutor`]: [`we_data::Executor`] over `ad4m-client`, read-only.
//!
//! `model_query` is `perspective.modelQuery`. `model_subscribe` answers
//! [`ExecutorError::Unsupported`]: the seam's `LiveQuery` cannot carry
//! updates, and live reads go through [`crate::Ad4mQuerySource`]. Writes,
//! commits, flows and shapes answer `Unsupported` too: E7 writes nothing
//! (E11 does).
use ad4m_client::model::Model;
use we_data::{
    ClassSel, ClassShape, Executor, ExecutorError, FlowCall, LiveQuery, LiveQueryId, QueryIr,
    Result, SpaceId, Write,
};
use we_expr::Value;

use crate::connection::Connection;
use crate::relations::Relations;

pub struct Ad4mExecutor {
    conn: Connection,
    relations: Relations,
}

impl Ad4mExecutor {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn,
            relations: Relations::core(),
        }
    }

    fn model(&self, space: &SpaceId, class: &ClassSel) -> Model {
        let names: Vec<String> = class.names().iter().map(|n| n.to_string()).collect();
        match class {
            ClassSel::One(name) => Model::new(self.conn.ws(), space.as_str(), name.to_string()),
            ClassSel::Many(_) => Model::new_union(self.conn.ws(), space.as_str(), names),
        }
    }
}

fn one_class(class: &ClassSel) -> Option<&str> {
    match class {
        ClassSel::One(name) => Some(name),
        ClassSel::Many(_) => None,
    }
}

fn other(e: impl std::fmt::Display) -> ExecutorError {
    ExecutorError::Other(e.to_string())
}

fn rows_value(instances: Vec<serde_json::Value>) -> Value {
    Value::List(crate::source::rows(instances))
}

#[async_trait::async_trait(?Send)]
impl Executor for Ad4mExecutor {
    async fn model_query(
        &self,
        space: &SpaceId,
        class: ClassSel,
        query: &QueryIr,
    ) -> Result<Value> {
        let q = crate::translate::model_query(query, one_class(&class), &self.relations)
            .map_err(other)?;
        let model = self.model(space, &class);
        let result = self
            .conn
            .run(async move { model.query(&q).await })
            .await
            .map_err(|e| other(format!("{e:#}")))?;
        Ok(rows_value(result.instances))
    }

    /// Refused (Lal F6): `we_data::LiveQuery` carries the first result and
    /// has no channel for the updates after it, so a subscription opened
    /// here would answer its first result forever, and dropping the handle
    /// would leave the executor-side subscription running. Live reads go
    /// through [`crate::Ad4mQuerySource`], which follows every update and
    /// disposes on close.
    async fn model_subscribe(
        &self,
        _space: &SpaceId,
        _class: ClassSel,
        _query: &QueryIr,
    ) -> Result<LiveQuery> {
        Err(ExecutorError::Unsupported(
            "model_subscribe through the Executor seam (it cannot follow updates); \
             live reads go through Ad4mQuerySource"
                .into(),
        ))
    }

    /// Nothing is ever opened here, so there is nothing to dispose.
    async fn dispose_query(&self, _space: &SpaceId, _id: &LiveQueryId) -> Result<bool> {
        Ok(false)
    }

    async fn write(&self, _space: &SpaceId, _write: Write) -> Result<Value> {
        Err(ExecutorError::Unsupported("write (E7 is read-only)".into()))
    }

    async fn commit(&self, _space: &SpaceId, _writes: Vec<Write>) -> Result<()> {
        Err(ExecutorError::Unsupported(
            "commit (E7 is read-only)".into(),
        ))
    }

    async fn flow(&self, _space: &SpaceId, call: FlowCall) -> Result<Value> {
        Err(ExecutorError::Unsupported(format!(
            "flow {} (E7 is read-only)",
            call.name
        )))
    }

    async fn shape(&self, _space: &SpaceId, class: &str) -> Result<ClassShape> {
        Err(ExecutorError::Unsupported(format!("shape {class}")))
    }
}
