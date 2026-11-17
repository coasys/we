//! [`Ad4mExecutor`]: [`we_data::Executor`] over `ad4m-client`.
//!
//! `model_query` is `perspective.modelQuery`. `model_subscribe` answers
//! [`ExecutorError::Unsupported`]: the seam's `LiveQuery` cannot carry
//! updates, and live reads go through [`crate::Ad4mQuerySource`]. `write`
//! is the validated write RPC (`perspective.instanceCreate`,
//! `instanceUpdate`, `instanceRemove`); a refusal keeps the executor's code,
//! message and `InstanceError` as [`ExecutorError::Rejected`]. Collection
//! writes, commits, flows and shapes answer `Unsupported` (not in E11).
use std::future::Future;

use ad4m_client::instances::{InstanceCreate, InstanceRemove, InstanceUpdate};
use ad4m_client::model::Model;
use ad4m_client::ws_rpc::RpcCallError;
use serde_json::{json, Map};
use we_data::{
    ClassSel, ClassShape, Executor, ExecutorError, FlowCall, LiveQuery, LiveQueryId, QueryIr,
    Result, SpaceId, Write, WriteOp,
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

    /// `write` as a `Send` future on the connection's runtime — for the
    /// write host, which settles through a `Completer` from that runtime.
    pub(crate) fn write_task(
        &self,
        space: SpaceId,
        write: Write,
    ) -> impl Future<Output = Result<Value>> + Send + 'static {
        write_on(self.conn.clone(), space, write)
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

/// A required string field of a write's body.
fn str_field(body: &serde_json::Value, key: &str) -> Result<String> {
    match body.get(key) {
        Some(serde_json::Value::String(s)) if !s.is_empty() => Ok(s.clone()),
        _ => Err(ExecutorError::Other(format!("write: missing {key}"))),
    }
}

/// An optional object field of a write's body.
fn obj_field(
    body: &serde_json::Value,
    key: &str,
) -> Result<Option<Map<String, serde_json::Value>>> {
    match body.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Object(m)) => Ok(Some(m.clone())),
        Some(_) => Err(ExecutorError::Other(format!(
            "write: {key} is not an object"
        ))),
    }
}

/// A refused or failed call as the seam's error: the executor's own code,
/// message and `data` when it answered with an error (`RpcCallError`,
/// found anywhere in the chain), else the error's text. Both scrubbed of
/// credentials, as every RPC error the adapter shows is.
fn rejected(e: anyhow::Error) -> ExecutorError {
    match e.chain().find_map(|c| c.downcast_ref::<RpcCallError>()) {
        Some(rpc) => ExecutorError::Rejected {
            code: rpc.code,
            message: crate::connect::scrub(&rpc.message),
            data: rpc.data.clone(),
        },
        None => ExecutorError::Other(crate::connect::scrub(&format!("{e:#}"))),
    }
}

/// One validated write on `conn`'s runtime. The reply is `{ id }`, the
/// instance's base URI — the `id` a row of a model query carries.
async fn write_on(conn: Connection, space: SpaceId, write: Write) -> Result<Value> {
    let body = &write.body;
    let class_name = str_field(body, "className")?;
    let uuid = space.as_str().to_string();
    let client = conn.client();
    let id = match write.op {
        WriteOp::Create => {
            let call = InstanceCreate {
                class_name,
                properties: obj_field(body, "properties")?,
                parent: body
                    .get("parent")
                    .and_then(|p| p.as_str())
                    .map(str::to_string),
                ..Default::default()
            };
            conn.run(async move { client.perspectives.instance_create(&uuid, call).await })
                .await
                .map_err(rejected)?
                .base_uri
        }
        WriteOp::Update => {
            let call = InstanceUpdate {
                class_name,
                base_uri: str_field(body, "baseUri")?,
                properties: obj_field(body, "properties")?.unwrap_or_default(),
                batch_id: None,
            };
            conn.run(async move { client.perspectives.instance_update(&uuid, call).await })
                .await
                .map_err(rejected)?
                .base_uri
        }
        WriteOp::Remove => {
            let call = InstanceRemove {
                class_name,
                base_uri: str_field(body, "baseUri")?,
                batch_id: None,
            };
            conn.run(async move { client.perspectives.instance_remove(&uuid, call).await })
                .await
                .map_err(rejected)?
                .base_uri
        }
        WriteOp::AddToCollection | WriteOp::RemoveFromCollection => {
            return Err(ExecutorError::Unsupported(
                "collection writes (not in E11)".into(),
            ))
        }
    };
    Ok(Value::from_json(&json!({ "id": id })))
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

    async fn write(&self, space: &SpaceId, write: Write) -> Result<Value> {
        self.write_task(space.clone(), write).await
    }

    async fn commit(&self, _space: &SpaceId, _writes: Vec<Write>) -> Result<()> {
        Err(ExecutorError::Unsupported("commit (not in E11)".into()))
    }

    async fn flow(&self, _space: &SpaceId, call: FlowCall) -> Result<Value> {
        Err(ExecutorError::Unsupported(format!(
            "flow {} (not in E11)",
            call.name
        )))
    }

    async fn shape(&self, _space: &SpaceId, class: &str) -> Result<ClassShape> {
        Err(ExecutorError::Unsupported(format!("shape {class}")))
    }
}
