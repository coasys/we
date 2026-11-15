//! [`Ad4mExecutor`]: [`we_data::Executor`] over `ad4m-client`, read-only.
//!
//! `model_query` is `perspective.modelQuery`; `model_subscribe` opens
//! `perspective.modelSubscribe` and keeps the subscription until
//! `dispose_query` ends it. Writes, commits, flows and shapes answer
//! [`ExecutorError::Unsupported`]: E7 writes nothing (E11 does).
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use ad4m_client::model::{Model, ModelSubscription};
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
    /// Open subscriptions by id — `dispose_query` ends them.
    live: Arc<Mutex<HashMap<String, Arc<ModelSubscription>>>>,
}

impl Ad4mExecutor {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn,
            relations: Relations::core(),
            live: Arc::default(),
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

    async fn model_subscribe(
        &self,
        space: &SpaceId,
        class: ClassSel,
        query: &QueryIr,
    ) -> Result<LiveQuery> {
        let q = crate::translate::model_query(query, one_class(&class), &self.relations)
            .map_err(other)?;
        let model = self.model(space, &class);
        let (sub, first, id) = self
            .conn
            .run(async move {
                let mut sub = model.subscribe(&q).await?;
                let first = sub.next().await.map(|r| r.instances).unwrap_or_default();
                let id = sub.id().await.unwrap_or_default();
                Ok((sub, first, id))
            })
            .await
            .map_err(|e| other(format!("{e:#}")))?;
        if let Ok(mut live) = self.live.lock() {
            live.insert(id.clone(), Arc::new(sub));
        }
        Ok(LiveQuery::new(LiveQueryId::new(id), rows_value(first), 0))
    }

    async fn dispose_query(&self, _space: &SpaceId, id: &LiveQueryId) -> Result<bool> {
        let sub = self
            .live
            .lock()
            .ok()
            .and_then(|mut l| l.remove(id.as_str()));
        let Some(sub) = sub else {
            return Ok(false);
        };
        self.conn
            .run(async move {
                sub.dispose().await;
                Ok(())
            })
            .await
            .map_err(other)?;
        Ok(true)
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
