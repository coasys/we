//! [`SnapshotQuerySource`]: a [`QuerySource`] that answers from the snapshot's
//! `queries` table — the same rows `LocalDecl::Static`/`snapshot_rows` give a
//! cell when no source is installed, for callers that need a source to exist.
//!
//! A `QueryKey` is a fingerprint of entity/dataset/IR — it carries no field
//! name — so the source learns `key → name` as cells report themselves: feed
//! it with [`SnapshotQuerySource::note`] per cell, or
//! [`SnapshotQuerySource::note_pool`] from a runtime's [`QueryPool`] after a
//! resolve. An unlearned key answers [`QueryState::Loading`] — the documented
//! "not answered yet" a gated or unseen query already gives.
use std::sync::{Arc, RwLock};

use indexmap::IndexMap;
use we_expr::Value;
use we_template::{QueryCell, QueryIr, QueryKey, QueryPool, QuerySource, QueryState, StoreBag};

/// `QuerySource` over `StoreBag::query`.
#[derive(Debug)]
pub struct SnapshotQuerySource {
    bag: Arc<StoreBag>,
    /// QueryKey string → the `$queries` field name that compiled to it.
    names: RwLock<IndexMap<String, Arc<str>>>,
}

impl SnapshotQuerySource {
    pub fn new(bag: Arc<StoreBag>) -> Self {
        Self {
            bag,
            names: RwLock::new(IndexMap::new()),
        }
    }

    /// Learn that `key` is the cell a `$queries` field named `name` compiled
    /// to — the mapping `QueryCell::note_name` keeps on the cell.
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
    /// after a resolve, so cells the next pass creates are answered too.
    pub fn note_pool(&self, pool: &QueryPool) {
        for cell in pool.cells() {
            self.note_cell(&cell);
        }
    }
}

impl QuerySource for SnapshotQuerySource {
    /// The `snapshot_rows` answer, by the cell's learned name: a `List` is the
    /// rows, any other named value becomes a one-row answer, anything else —
    /// an unlearned key or a name the snapshot does not have — is `Loading`.
    fn rows(&self, key: &QueryKey, _ir: &QueryIr) -> QueryState {
        let name = self
            .names
            .read()
            .ok()
            .and_then(|names| names.get(key.as_str()).cloned());
        let Some(name) = name else {
            return QueryState::Loading;
        };
        match self.bag.query(&name) {
            Value::List(rows) => QueryState::Rows(rows),
            Value::Undefined => QueryState::Loading,
            other => QueryState::Rows(Arc::new(vec![other])),
        }
    }
}
