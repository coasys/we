//! Live rows for `GraphView` under `--connect`.
//!
//! `shape()` cannot list models, so the schema view uses the committed
//! core shapes. Each other class is one `model_query` (limit 200, every
//! relation included). `WeNode` is the base class, not a table of rows.
//! The UI thread installs the world when the worker finishes. Until then
//! the widget has an empty world and still draws the schema.

use std::sync::{Arc, Mutex};

use egui::Context;
use we_ad4m::{Ad4mExecutor, Connection};
use we_data::{ClassSel, Executor, QueryIr, SpaceId};
use we_egui::{install_graph, GraphInstall};
use we_graph::{core_shapes, Record, World};

pub struct GraphLoad {
    slot: Arc<Mutex<Option<GraphInstall>>>,
}

impl GraphLoad {
    /// Install an empty world now, then fill it from the executor.
    /// Schema nodes come from the core shapes and do not wait on rows.
    pub fn begin(conn: &Connection, space: &str, ctx: &Context) -> Self {
        let shapes: Arc<[we_graph::Shape]> = core_shapes().to_vec().into();
        install_graph(
            ctx,
            GraphInstall {
                world: Arc::new(World::from_records(Vec::new())),
                shapes: Arc::clone(&shapes),
                dataset: Arc::from(space),
                generation: 0,
            },
        );
        let slot = Arc::new(Mutex::new(None));
        let out = Arc::clone(&slot);
        let conn = conn.clone();
        let space = space.to_string();
        let ctx = ctx.clone();
        let handle = conn.handle().clone();
        let spawned = std::thread::Builder::new()
            .name("we-graph-load".into())
            .spawn(move || {
                let install = handle.block_on(load(&conn, &space, shapes));
                if let Ok(mut guard) = out.lock() {
                    *guard = Some(install);
                }
                ctx.request_repaint();
            });
        if let Err(e) = spawned {
            log::warn!("graph load: {e}");
        }
        Self { slot }
    }

    /// Install the world once the worker has it.
    pub fn poll(&self, ctx: &Context) {
        let ready = self.slot.lock().ok().and_then(|mut guard| guard.take());
        if let Some(install) = ready {
            install_graph(ctx, install);
        }
    }
}

async fn load(conn: &Connection, space: &str, shapes: Arc<[we_graph::Shape]>) -> GraphInstall {
    let exec = Ad4mExecutor::new(conn.clone());
    let space_id = SpaceId::new(space);
    let mut records = Vec::new();
    for shape in shapes.iter() {
        if shape.name == "WeNode" {
            continue;
        }
        let mut include = serde_json::Map::new();
        for relation in &shape.relations {
            include.insert(relation.name.clone(), serde_json::Value::Bool(true));
        }
        let query = QueryIr {
            limit: Some(200),
            include: if include.is_empty() {
                None
            } else {
                Some(serde_json::Value::Object(include))
            },
            ..QueryIr::default()
        };
        match exec
            .model_query(&space_id, ClassSel::one(shape.name.as_str()), &query)
            .await
        {
            Ok(we_expr::Value::List(rows)) => {
                for row in rows.iter() {
                    if let Some(record) =
                        Record::from_instance(&shape.name, &row.to_json(), Some(shape))
                    {
                        records.push(record);
                    }
                }
            }
            Ok(_) => {}
            Err(e) => log::warn!("graph load {}: {e}", shape.name),
        }
    }
    GraphInstall {
        world: Arc::new(World::from_records(records)),
        shapes,
        dataset: Arc::from(space),
        generation: 0,
    }
}
