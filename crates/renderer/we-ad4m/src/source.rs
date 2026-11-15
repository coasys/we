//! [`Ad4mQuerySource`]: the template's `$queries` answered by a live
//! executor — `perspective.modelSubscribe` for a subscribed read,
//! `perspective.modelQuery` for `subscribe: false`.
//!
//! `open` translates the request ([`crate::translate`]), spawns one task on
//! the connection's runtime, and returns: the task pushes the first result
//! and every later one on the ticket's [`QuerySink`] — an arrival on the
//! session's inbox, which wakes the frontend. There is no polling: a
//! subscribed read only ever answers when the executor pushes.
//!
//! Reconnect is the client's: after a dropped socket `ad4m-client` re-opens
//! every live subscription and pushes its fresh full result, which arrives
//! here like any update (`ModelSubscription::next`).
//!
//! `close` asks the task to stop; it disposes the executor-side subscription
//! (`perspective.disposeQuery`) before it ends, so nothing is left running
//! for a cell nobody reads.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use ad4m_client::model::{Model, ModelQuery};
use we_expr::{HandleTable, SpaceHandle, Value};
use we_template::{DatasetSel, QueryEvent, QueryRequest, QuerySink, QuerySource, SubTicket};

use crate::connection::Connection;
use crate::relations::Relations;

/// The perspective a source reads, and the names it answers to — the route
/// segment a `Here` read keys by (`/space/<key>`) is the perspective uuid,
/// or its neighbourhood URL for a shared space.
#[derive(Debug, Clone)]
pub struct SpaceBinding {
    pub uuid: String,
    /// Every dataset key that means this perspective.
    pub keys: Vec<String>,
}

impl SpaceBinding {
    pub fn new(uuid: impl Into<String>) -> Self {
        let uuid = uuid.into();
        Self {
            keys: vec![uuid.clone()],
            uuid,
        }
    }

    /// Also answer to `key` (a neighbourhood URL, the route's segment).
    pub fn also(mut self, key: impl Into<String>) -> Self {
        self.keys.push(key.into());
        self
    }

    fn answers(&self, key: &str) -> bool {
        self.keys.iter().any(|k| k == key)
    }
}

/// What the source did — for the debug overlay and the tests.
#[derive(Debug, Default)]
pub struct SourceStats {
    /// Subscriptions open right now.
    pub open: AtomicU64,
    /// Result sets delivered (first results and updates).
    pub deliveries: AtomicU64,
    /// Requests that failed — translation, a refused dataset, an RPC error.
    pub failures: AtomicU64,
    /// The last few failures, newest last: the entity and the reason.
    pub recent_failures: Mutex<Vec<String>>,
}

impl SourceStats {
    const KEEP: usize = 20;

    fn fail(&self, what: String) {
        self.failures.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut recent) = self.recent_failures.lock() {
            recent.push(what);
            let over = recent.len().saturating_sub(Self::KEEP);
            recent.drain(..over);
        }
    }

    /// The last few failures, newest last.
    pub fn failures_seen(&self) -> Vec<String> {
        self.recent_failures
            .lock()
            .map(|r| r.clone())
            .unwrap_or_default()
    }
}

/// `QuerySource` over a live executor, bound to one perspective.
pub struct Ad4mQuerySource {
    conn: Connection,
    space: SpaceBinding,
    relations: Relations,
    stops: Mutex<HashMap<SubTicket, tokio::sync::oneshot::Sender<()>>>,
    stats: Arc<SourceStats>,
}

impl std::fmt::Debug for Ad4mQuerySource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Ad4mQuerySource")
            .field("space", &self.space)
            .finish_non_exhaustive()
    }
}

impl Ad4mQuerySource {
    pub fn new(conn: Connection, space: SpaceBinding) -> Self {
        Self {
            conn,
            space,
            relations: Relations::core(),
            stops: Mutex::new(HashMap::new()),
            stats: Arc::default(),
        }
    }

    pub fn stats(&self) -> Arc<SourceStats> {
        self.stats.clone()
    }

    /// The perspective a request reads: its dataset's key must be one this
    /// source answers to. A `Here` read with no mount space is this space.
    fn resolve_dataset(&self, request: &QueryRequest, handles: &HandleTable) -> Result<(), String> {
        let handle = match &request.dataset {
            DatasetSel::Here => request.space.as_ref().map(SpaceHandle::handle),
            DatasetSel::Named(h) => Some(h.handle()),
        };
        let Some(handle) = handle else {
            return match request.dataset {
                DatasetSel::Here => Ok(()),
                DatasetSel::Named(_) => Err("dataset handle is unknown".into()),
            };
        };
        match handles.key(handle) {
            Some(key) if self.space.answers(&key) => Ok(()),
            Some(key) => Err(format!(
                "dataset {key:?} is not the open space ({})",
                self.space.uuid
            )),
            None => Err("dataset handle is unknown".into()),
        }
    }
}

/// The instances as template rows.
pub(crate) fn rows(instances: Vec<serde_json::Value>) -> Arc<Vec<Value>> {
    Arc::new(instances.iter().map(Value::from_json).collect())
}

fn failed(sink: &QuerySink, stats: &SourceStats, what: &str, message: String) {
    // An RPC error can quote an endpoint; none is shown with credentials.
    let message = crate::connect::scrub(&message);
    log::warn!("we-ad4m: {what}: {message}");
    stats.fail(format!("{what}: {message}"));
    sink.deliver(QueryEvent::Failed(Value::Str(message.into())));
}

impl QuerySource for Ad4mQuerySource {
    fn open(
        &self,
        ticket: SubTicket,
        request: &QueryRequest,
        handles: &HandleTable,
        sink: QuerySink,
    ) {
        let classes: Vec<String> = request.classes.iter().map(|c| c.to_string()).collect();
        let what = classes.join("|");
        if let Err(e) = self.resolve_dataset(request, handles) {
            return failed(&sink, &self.stats, &what, e);
        }
        let one = (!request.union && classes.len() == 1).then(|| classes[0].as_str());
        let query = match crate::translate::model_query(&request.ir, one, &self.relations) {
            Ok(q) => q,
            Err(e) => return failed(&sink, &self.stats, &what, e),
        };
        let model = if request.union || classes.len() > 1 {
            Model::new_union(self.conn.ws(), self.space.uuid.clone(), classes)
        } else {
            match classes.into_iter().next() {
                Some(c) => Model::new(self.conn.ws(), self.space.uuid.clone(), c),
                None => return failed(&sink, &self.stats, &what, "query names no entity".into()),
            }
        };
        let stats = self.stats.clone();
        if !request.subscribe {
            self.conn.spawn(async move {
                match model.query(&query).await {
                    Ok(r) => {
                        stats.deliveries.fetch_add(1, Ordering::Relaxed);
                        sink.deliver(QueryEvent::Rows(rows(r.instances)));
                    }
                    Err(e) => failed(&sink, &stats, &what, format!("{e:#}")),
                }
            });
            return;
        }
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
        if let Ok(mut stops) = self.stops.lock() {
            stops.insert(ticket, stop_tx);
        }
        self.conn
            .spawn(subscribe(model, query, sink, stats, what, stop_rx));
    }

    fn close(&self, ticket: SubTicket) {
        let stop = self.stops.lock().ok().and_then(|mut s| s.remove(&ticket));
        if let Some(stop) = stop {
            let _ = stop.send(());
        }
    }
}

/// One live read: open, deliver every distinct result, dispose on `stop`.
async fn subscribe(
    model: Model,
    query: ModelQuery,
    sink: QuerySink,
    stats: Arc<SourceStats>,
    what: String,
    mut stop: tokio::sync::oneshot::Receiver<()>,
) {
    let mut sub = tokio::select! {
        r = model.subscribe(&query) => match r {
            Ok(sub) => sub,
            Err(e) => return failed(&sink, &stats, &what, format!("{e:#}")),
        },
        _ = &mut stop => return,
    };
    stats.open.fetch_add(1, Ordering::Relaxed);
    loop {
        tokio::select! {
            next = sub.next() => match next {
                Some(result) => {
                    stats.deliveries.fetch_add(1, Ordering::Relaxed);
                    sink.deliver(QueryEvent::Rows(rows(result.instances)));
                }
                // The socket closed for good: the last rows stay.
                None => break,
            },
            _ = &mut stop => break,
        }
    }
    sub.dispose().await;
    stats.open.fetch_sub(1, Ordering::Relaxed);
}
