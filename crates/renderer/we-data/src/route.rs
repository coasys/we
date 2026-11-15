//! The C2a recorder's per-route captures (`meta.format: "we-snapshot@2"`).
//!
//! `routes.<id>` is per-route truth: the resolved `members` tree and one
//! capture per `$queries` declaration the route's surfaces carry. A capture's
//! identity is its declaration site (`scope`), the `dataset` it ran against
//! and the resolved `request` — never its local `name`: the tree's
//! `signalTypes` sorts by name and the inspector's does not, and both are
//! called `signalTypes`.
//!
//! Exactly one outcome per capture: `rows` (an answer — `[]` is an answered
//! empty list), `skipped` (`when` / `unanchored-scope` — never asked, so it
//! is not an answer at all), or `failed`. Only `rows` captures can answer a
//! request; a skipped one leaves the cell `Loading`, as TS leaves it.
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use indexmap::IndexMap;
use serde_json::{Map as JsonMap, Value as Json};
use we_expr::Value;
use we_template::{
    DatasetSel, QueryEvent, QueryIr, QueryRequest, QuerySink, QuerySource, SubTicket,
};

use crate::executor::{ClassSel, SpaceId};

/// The format string the route captures are read under.
pub(crate) const FORMAT_V2: &str = "we-snapshot@2";

/// `meta.format` when the document declares one: only `we-snapshot@2` is
/// known; anything else is refused rather than half-read.
pub(crate) fn format(json: &Json) -> Result<Option<&str>, String> {
    let Some(format) = json.get("meta").and_then(|m| m.get("format")) else {
        return Ok(None);
    };
    match format.as_str() {
        Some(FORMAT_V2) => Ok(Some(FORMAT_V2)),
        Some(other) => Err(format!(
            "snapshot: unsupported meta.format {other:?} (reader knows {FORMAT_V2:?})"
        )),
        None => Err(format!("snapshot: meta.format must be text, got {format}")),
    }
}

/// A `we-snapshot@2` document's `routes`: an object of route captures, each
/// with an object `members` and a list of well-formed `queries` captures.
pub(crate) fn validate_routes(json: &Json) -> Result<(), String> {
    let Some(routes) = json.get("routes") else {
        return Ok(());
    };
    let routes = routes
        .as_object()
        .ok_or("snapshot: routes must be an object of route captures")?;
    for (id, route) in routes {
        let route = route
            .as_object()
            .ok_or_else(|| format!("snapshot: routes.{id} must be an object"))?;
        if let Some(members) = route.get("members") {
            if !members.is_object() {
                return Err(format!("snapshot: routes.{id}.members must be an object"));
            }
        }
        if let Some(agents) = route.get("agents") {
            if !agents.is_object() {
                return Err(format!("snapshot: routes.{id}.agents must be an object"));
            }
        }
        let queries = match route.get("queries") {
            None => continue,
            Some(q) => q
                .as_array()
                .ok_or_else(|| format!("snapshot: routes.{id}.queries must be a list"))?,
        };
        for (i, capture) in queries.iter().enumerate() {
            Capture::parse(capture)
                .map_err(|e| format!("snapshot: routes.{id}.queries[{i}]: {e}"))?;
        }
    }
    Ok(())
}

/// One recorded `$queries` declaration on one route.
#[derive(Debug, Clone)]
pub(crate) struct Capture {
    pub name: String,
    pub scope: String,
    pub dataset: Option<String>,
    pub request: Option<Json>,
    pub outcome: Outcome,
}

#[derive(Debug, Clone)]
pub(crate) enum Outcome {
    Rows(Arc<Vec<Value>>),
    Skipped(String),
    Failed(String),
}

impl Capture {
    fn parse(json: &Json) -> Result<Capture, String> {
        let obj = json.as_object().ok_or("a capture must be an object")?;
        let text = |key: &str| -> Result<String, String> {
            obj.get(key)
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .ok_or_else(|| format!("{key} must be text"))
        };
        let name = text("name")?;
        let scope = text("scope")?;
        let dataset = match obj.get("dataset") {
            None | Some(Json::Null) => None,
            Some(Json::String(s)) => Some(s.clone()),
            Some(other) => return Err(format!("dataset must be text or null, got {other}")),
        };
        let request = match obj.get("request") {
            None | Some(Json::Null) => None,
            Some(r @ Json::Object(_)) => Some(r.clone()),
            Some(other) => return Err(format!("request must be an object, got {other}")),
        };
        let outcomes = ["rows", "skipped", "failed"]
            .into_iter()
            .filter(|k| obj.contains_key(*k))
            .count();
        if outcomes != 1 {
            return Err(format!(
                "{name} @ {scope}: exactly one of rows/skipped/failed, found {outcomes}"
            ));
        }
        let outcome = if let Some(rows) = obj.get("rows") {
            let rows = rows
                .as_array()
                .ok_or_else(|| format!("{name} @ {scope}: rows must be a list"))?;
            if request.is_none() {
                return Err(format!(
                    "{name} @ {scope}: answered rows without the request they answer"
                ));
            }
            Outcome::Rows(Arc::new(rows.iter().map(Value::from_json).collect()))
        } else if let Some(s) = obj.get("skipped") {
            Outcome::Skipped(s.as_str().unwrap_or_default().to_string())
        } else {
            Outcome::Failed(match &obj["failed"] {
                Json::String(s) => s.clone(),
                other => other.to_string(),
            })
        };
        Ok(Capture {
            name,
            scope,
            dataset,
            request,
            outcome,
        })
    }
}

/// A request's identity, the way a capture and a pool cell can both name it:
/// the entities, whether they are a union, the dataset it runs against and
/// the rest of the request — rendered canonically (object keys sorted), so
/// key order never decides a match.
///
/// `subscribe` is not part of it: the recorder resolves each declaration
/// once through the adapter's `findAll`, so a capture answers the question
/// whether the template subscribes to it or reads it once.
pub(crate) fn identity(entities: &[String], union: bool, dataset: &str, rest: &Json) -> String {
    let mut doc = JsonMap::new();
    doc.insert(
        "e".into(),
        Json::Array(entities.iter().cloned().map(Json::String).collect()),
    );
    doc.insert("u".into(), Json::Bool(union));
    doc.insert("ds".into(), Json::String(dataset.to_string()));
    doc.insert("ir".into(), rest.clone());
    canonical(&Json::Object(doc))
}

/// JSON text with every object's keys sorted.
fn canonical(json: &Json) -> String {
    fn sorted(json: &Json) -> Json {
        match json {
            Json::Object(map) => {
                let ordered: BTreeMap<&String, Json> =
                    map.iter().map(|(k, v)| (k, sorted(v))).collect();
                Json::Object(ordered.into_iter().map(|(k, v)| (k.clone(), v)).collect())
            }
            Json::Array(items) => Json::Array(items.iter().map(sorted).collect()),
            other => other.clone(),
        }
    }
    serde_json::to_string(&sorted(json)).unwrap_or_default()
}

/// `entity` as written in a request: a name, or a list of names (a union).
fn entity_names(entity: &Json) -> Option<(Vec<String>, bool)> {
    match entity {
        Json::String(s) => Some((vec![s.clone()], false)),
        Json::Array(items) => Some((
            items
                .iter()
                .map(|i| i.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()?,
            true,
        )),
        _ => None,
    }
}

/// A request object without the keys that are not part of its question:
/// `entity` (carried separately), `dataset` (resolved separately) and the
/// descriptor-level `subscribe`/`when` the IR never holds.
fn request_rest(request: &JsonMap<String, Json>) -> Json {
    Json::Object(
        request
            .iter()
            .filter(|(k, _)| !matches!(k.as_str(), "entity" | "dataset" | "subscribe" | "when"))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    )
}

/// What a request identity answers to on one route.
#[derive(Debug, Clone)]
enum Answer {
    /// Every capture with this identity recorded these rows.
    Rows {
        rows: Arc<Vec<Value>>,
        scopes: Vec<String>,
    },
    /// Two captures asked the same question and recorded different rows —
    /// no binding can say which one a cell is, so neither answers.
    Ambiguous { scopes: Vec<String> },
}

/// One route's recorded answers, bound by `dataset + request` (with the
/// `scope`s that recorded each kept beside it), never by name.
#[derive(Debug)]
pub struct RouteCaptures {
    route: String,
    /// The space a request with no dataset of its own runs against.
    space: Option<SpaceId>,
    answers: IndexMap<String, Answer>,
    captures: Vec<Capture>,
    /// Identities a cell or a call asked that no answer bound — the
    /// recorder never answered that question on this route.
    missed: Mutex<Vec<String>>,
}

impl RouteCaptures {
    pub(crate) fn parse(route: &str, json: &Json, space: Option<SpaceId>) -> Result<Self, String> {
        let mut captures = Vec::new();
        if let Some(list) = json.get("queries").and_then(|q| q.as_array()) {
            for (i, c) in list.iter().enumerate() {
                captures.push(
                    Capture::parse(c).map_err(|e| format!("routes.{route}.queries[{i}]: {e}"))?,
                );
            }
        }
        let mut answers: IndexMap<String, Answer> = IndexMap::new();
        for capture in &captures {
            let Outcome::Rows(rows) = &capture.outcome else {
                continue;
            };
            let request = capture
                .request
                .as_ref()
                .and_then(|r| r.as_object())
                .ok_or_else(|| {
                    format!("routes.{route}: {} has rows but no request", capture.name)
                })?;
            let (entities, union) =
                request
                    .get("entity")
                    .and_then(entity_names)
                    .ok_or_else(|| {
                        format!(
                            "routes.{route}: {} @ {} answered a request with no entity",
                            capture.name, capture.scope
                        )
                    })?;
            let dataset = capture
                .dataset
                .clone()
                .or_else(|| space.as_ref().map(|s| s.as_str().to_string()))
                .ok_or_else(|| {
                    format!(
                        "routes.{route}: {} @ {} answered with no dataset, and the snapshot names no space",
                        capture.name, capture.scope
                    )
                })?;
            let key = identity(&entities, union, &dataset, &request_rest(request));
            let entry = answers.entry(key).or_insert_with(|| Answer::Rows {
                rows: rows.clone(),
                scopes: Vec::new(),
            });
            *entry = match std::mem::replace(entry, Answer::Ambiguous { scopes: Vec::new() }) {
                Answer::Rows {
                    rows: held,
                    mut scopes,
                } => {
                    scopes.push(capture.scope.clone());
                    if same_rows(&held, rows) {
                        Answer::Rows { rows: held, scopes }
                    } else {
                        Answer::Ambiguous { scopes }
                    }
                }
                Answer::Ambiguous { mut scopes } => {
                    scopes.push(capture.scope.clone());
                    Answer::Ambiguous { scopes }
                }
            };
        }
        Ok(RouteCaptures {
            route: route.to_string(),
            space,
            answers,
            captures,
            missed: Mutex::new(Vec::new()),
        })
    }

    /// The route id these captures were recorded on.
    pub fn route(&self) -> &str {
        &self.route
    }

    /// How many captures answered, were skipped, and failed.
    pub fn counts(&self) -> (usize, usize, usize) {
        let mut out = (0, 0, 0);
        for c in &self.captures {
            match c.outcome {
                Outcome::Rows(_) => out.0 += 1,
                Outcome::Skipped(_) => out.1 += 1,
                Outcome::Failed(_) => out.2 += 1,
            }
        }
        out
    }

    /// `(name, scope, reason)` of every capture that is not an answer —
    /// skipped (`when`, `unanchored-scope`) or failed.
    pub fn unanswered(&self) -> Vec<(String, String, String)> {
        self.captures
            .iter()
            .filter_map(|c| match &c.outcome {
                Outcome::Rows(_) => None,
                Outcome::Skipped(r) => {
                    Some((c.name.clone(), c.scope.clone(), format!("skipped: {r}")))
                }
                Outcome::Failed(r) => {
                    Some((c.name.clone(), c.scope.clone(), format!("failed: {r}")))
                }
            })
            .collect()
    }

    /// The scopes of every identity two captures answered differently.
    pub fn ambiguous(&self) -> Vec<Vec<String>> {
        self.answers
            .values()
            .filter_map(|a| match a {
                Answer::Ambiguous { scopes } => Some(scopes.clone()),
                Answer::Rows { .. } => None,
            })
            .collect()
    }

    /// Identities asked on this route that no capture answered.
    pub fn missed(&self) -> Vec<String> {
        self.missed.lock().map(|m| m.clone()).unwrap_or_default()
    }

    /// The recorded rows for a claimed request, by identity — `None` when
    /// no capture answered it (never asked, skipped, failed, or two
    /// captures disagree). The request is read directly, never parsed back
    /// from a key.
    pub fn rows_for_claim(&self, request: &QueryRequest) -> Option<Arc<Vec<Value>>> {
        let entities: Vec<String> = request.classes.iter().map(|e| e.to_string()).collect();
        let dataset = match &request.dataset {
            DatasetSel::Named(handle) => Some(handle.as_str().to_string()),
            DatasetSel::Here => None,
        };
        let rest = match request.ir_json() {
            Json::Object(ir) => request_rest(&ir),
            _ => Json::Object(JsonMap::new()),
        };
        self.lookup(&entities, request.union, dataset, &rest)
    }

    /// The recorded rows for an executor request — the same identity a pool
    /// cell's key carries, in the dataset of the call's space.
    pub(crate) fn rows_for_request(
        &self,
        space: &SpaceId,
        class: &ClassSel,
        q: &QueryIr,
    ) -> Option<Arc<Vec<Value>>> {
        let entities: Vec<String> = class.names().iter().map(|e| e.to_string()).collect();
        let rest = match serde_json::to_value(q) {
            Ok(Json::Object(ir)) => request_rest(&ir),
            _ => Json::Object(JsonMap::new()),
        };
        // The IR names no dataset: the call's space is the dataset — never
        // the collection's default, which may be another space or none.
        self.lookup(
            &entities,
            matches!(class, ClassSel::Many(_)),
            Some(space.as_str().to_string()),
            &rest,
        )
    }

    fn lookup(
        &self,
        entities: &[String],
        union: bool,
        dataset: Option<String>,
        rest: &Json,
    ) -> Option<Arc<Vec<Value>>> {
        let dataset = dataset.or_else(|| self.space.as_ref().map(|s| s.as_str().to_string()));
        let key = dataset
            .as_deref()
            .map(|ds| identity(entities, union, ds, rest));
        let found = key.as_ref().and_then(|k| match self.answers.get(k) {
            Some(Answer::Rows { rows, .. }) => Some(rows.clone()),
            _ => None,
        });
        if found.is_none() {
            if let Ok(mut missed) = self.missed.lock() {
                missed.push(key.unwrap_or_else(|| canonical(rest)));
            }
        }
        found
    }
}

/// Recorded rows compared as JSON — the same answer twice is one answer.
fn same_rows(a: &[Value], b: &[Value]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_json() == y.to_json())
}

/// A [`QuerySource`] answering a claim from one route's captures, by the
/// request's identity. A request no capture answered delivers nothing —
/// the TS state of a query that was never asked (skipped) or has not
/// answered.
#[derive(Debug, Clone)]
pub struct RouteQuerySource {
    captures: Arc<RouteCaptures>,
}

impl RouteQuerySource {
    pub fn new(captures: Arc<RouteCaptures>) -> Self {
        Self { captures }
    }

    pub fn captures(&self) -> &RouteCaptures {
        &self.captures
    }
}

impl QuerySource for RouteQuerySource {
    fn open(&self, _ticket: SubTicket, request: &QueryRequest, sink: QuerySink) {
        if let Some(rows) = self.captures.rows_for_claim(request) {
            sink.deliver(QueryEvent::Rows(rows));
        }
    }

    /// A recording has nothing to dispose.
    fn close(&self, _ticket: SubTicket) {}
}
