//! [`SnapshotQuerySource`]: a [`QuerySource`] that answers from the snapshot's
//! `queries` table — the same answer the runtime's default source gives,
//! for callers that need a source to exist (a runtime resolved against one
//! shared bag, or a test installing the table explicitly).
//!
//! The `queries` table is name-keyed and the key carries no field name, so
//! the source answers by the request's `name_hint` — the `$queries` field
//! name the claim stamped on it. An anonymous request (an inline
//! `{"$query"}` site) or a name the table lacks delivers nothing — the
//! documented "not answered yet" a gated or unseen query already gives.
use std::sync::Arc;

use we_expr::Value;
use we_template::{QueryEvent, QueryRequest, QuerySink, QuerySource, StoreBag, SubTicket};

/// `QuerySource` over `StoreBag::query`.
#[derive(Debug)]
pub struct SnapshotQuerySource {
    bag: Arc<StoreBag>,
}

impl SnapshotQuerySource {
    pub fn new(bag: Arc<StoreBag>) -> Self {
        Self { bag }
    }
}

impl QuerySource for SnapshotQuerySource {
    /// The `queries` table's answer for the request's field name: a `List`
    /// is the rows, any other named value becomes a one-row answer, and a
    /// name the snapshot does not have delivers nothing — the cell stays
    /// loading, exactly as an unanswered TS `subscribe` does.
    fn open(&self, _ticket: SubTicket, request: &QueryRequest, sink: QuerySink) {
        let Some(name) = request.name_hint.as_deref() else {
            return;
        };
        match self.bag.query(name) {
            Value::List(rows) => sink.deliver(QueryEvent::Rows(rows)),
            Value::Undefined => {}
            other => sink.deliver(QueryEvent::Rows(Arc::new(vec![other]))),
        }
    }

    /// A name-keyed table has nothing to dispose.
    fn close(&self, _ticket: SubTicket) {}
}
