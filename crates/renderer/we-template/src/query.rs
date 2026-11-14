//! `$queries` — the compiled descriptor, the pool key, and the state a row
//! list is in.
//!
//! A node's `$queries` block declares named row lists. At resolve time each
//! declaration compiles to a [`QueryIr`] (`resolveQueryProp` +
//! `createQuerySignal` in the TS): `entity`/`dataset`/`subscribe`/`when` are
//! resolved for the descriptor itself, everything else lands in `params` and
//! is `deepResolveTokens`'d into the IR's `where`/`order`/`limit`/`offset`/
//! `include`/`select`/`scope`.
//!
//! The pool ([`QueryPool`]) shares one cell per [`QueryKey`] — the full IR,
//! not just the entity (the subscription pool's "keyed by what is asked,
//! never by the object asking").
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use we_expr::{ParseCache, Value};

use crate::resolve::{eval_json, eval_str};
use crate::resolved::Scope;
use crate::scope::StoreBag;

/// A compiled query — the `$query` descriptor after expressions are resolved
/// (`QueryDescriptor` in `types.ts`, compiled for the backend's query IR).
/// Fields stay raw JSON where the recipe is data.
///
/// Home is `we-template` — the resolver compiles descriptors; `we-data`
/// re-exports this type so the executor signature names the same thing.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QueryIr {
    /// `where` on the wire — `where_` is only the Rust-legal field name.
    /// Without the rename the executor drops every filter.
    #[serde(rename = "where", skip_serializing_if = "Option::is_none")]
    pub where_: Option<Json>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<Json>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include: Option<Json>,
    /// `select`: the fields a row carries; `id` always comes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub select: Option<Vec<String>>,
    /// `scope`: anchor drill-down (`via` / `anchorId` / transitive / direction).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<Json>,
    /// Every other resolved param — `resolveQueryProp` keeps `params`
    /// wholesale; dropping an unrecognized key would let two different
    /// reads collide on one pool cell. Never an authority-bearing name
    /// ([`RESERVED_IR_KEYS`]): the dataset is [`QueryRequest::dataset`], not
    /// a field of the IR.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Json>,
}

/// Param names that could select where a read runs or who it runs as.
/// `extra` is flattened onto the wire, so a param spelled like one of these
/// would reach a source beside the typed [`DatasetSel`]. The compiler gates
/// a query that authors one; a source refuses an IR that carries one
/// ([`QueryIr::reserved_key`]). `dataset` is the descriptor's own key and
/// never lands in `params`; it is listed for the wire.
pub const RESERVED_IR_KEYS: &[&str] = &["dataset", "space", "origin", "authority", "tier"];

impl QueryIr {
    /// The first authority-bearing name this IR carries in `extra`, if any.
    /// A source must refuse such a request rather than interpret it.
    pub fn reserved_key(&self) -> Option<&'static str> {
        RESERVED_IR_KEYS
            .iter()
            .copied()
            .find(|k| self.extra.contains_key(*k))
    }
}

/// The dataset identity a key is made from: today's resolved `dataset`
/// value as an opaque comparable string. E3c-7 replaces the inside with an
/// interned handle without changing this API.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct DatasetHandle(Arc<str>);

impl DatasetHandle {
    pub fn new(id: impl Into<Arc<str>>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Which dataset a request reads — the only dataset selector a request has.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum DatasetSel {
    /// The mount's own space. Until mounts carry a space this keys as the
    /// pull path always keyed a dataset-less read.
    Here,
    /// A dataset the template named (its resolved `dataset`).
    Named(DatasetHandle),
}

/// A compiled `$queries` entry: every field a source needs is a field, and
/// the key is derived from it, never parsed back.
#[derive(Clone, Debug)]
pub struct QueryRequest {
    /// `entityNamesOf`: deduped, blanks dropped.
    pub classes: Arc<[Arc<str>]>,
    /// The entity was written as a list: one merged answer.
    pub union: bool,
    /// `subscribe` after evaluation; `false` asks once.
    pub subscribe: bool,
    pub dataset: DatasetSel,
    /// where/order/limit/offset/include/select/scope, operands resolved.
    pub ir: QueryIr,
    /// The `$queries` field name, when there is one. Not part of the key.
    pub name_hint: Option<Arc<str>>,
}

impl QueryRequest {
    /// The pool key: `{e, u, ds, sub, ir}` in that field order. `Here`
    /// resolves to `here` (the mount's space) before hashing; with no mount
    /// space it keys as `null`, exactly as a dataset-less read always keyed,
    /// so a `Named` dataset can never collide with it whatever it is called.
    pub fn key(&self, here: Option<&DatasetHandle>) -> QueryKey {
        let ds = match &self.dataset {
            DatasetSel::Here => here,
            DatasetSel::Named(handle) => Some(handle),
        };
        let mut key_obj = serde_json::Map::new();
        key_obj.insert(
            "e".to_string(),
            Json::Array(
                self.classes
                    .iter()
                    .map(|e| Json::String(e.to_string()))
                    .collect(),
            ),
        );
        key_obj.insert("u".to_string(), Json::Bool(self.union));
        key_obj.insert(
            "ds".to_string(),
            ds.map(|h| Json::String(h.as_str().to_string()))
                .unwrap_or(Json::Null),
        );
        key_obj.insert("sub".to_string(), Json::Bool(self.subscribe));
        key_obj.insert("ir".to_string(), self.ir_json());
        QueryKey(
            serde_json::to_string(&Json::Object(key_obj))
                .unwrap_or_default()
                .into(),
        )
    }

    /// The IR as it goes on the wire.
    pub fn ir_json(&self) -> Json {
        serde_json::to_value(&self.ir).unwrap_or(Json::Null)
    }
}

/// What compiling one `$queries` entry gives.
#[derive(Clone, Debug)]
pub enum Compiled {
    /// Send it.
    Ready(QueryRequest),
    /// Its descriptor read a query slot that has not loaded yet: do not
    /// send. The slot answers like a gated one.
    Provisional(QueryRequest),
    /// `when` false, unresolved entity, unresolved bound, reserved param.
    Gated,
}

/// What a compile evaluates against besides the scope.
pub struct CompileCx<'a> {
    pub bag: &'a StoreBag,
    pub cache: &'a mut ParseCache,
    pub warnings: &'a mut Vec<Arc<str>>,
}

impl<'a> CompileCx<'a> {
    pub fn new(
        bag: &'a StoreBag,
        cache: &'a mut ParseCache,
        warnings: &'a mut Vec<Arc<str>>,
    ) -> Self {
        Self {
            bag,
            cache,
            warnings,
        }
    }
}

/// A query's identity: the entity names, the dataset, `subscribe` and the
/// full IR — the string the pool dedups on. Two nodes asking the same thing
/// share a cell; two that differ anywhere in the IR do not.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct QueryKey(Arc<str>);

impl QueryKey {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A query's rows, or not yet — the `loaded` flag a `<name>Loaded` field
/// reads is `matches!(Rows)` (an error reports loaded too, as WE's does).
#[derive(Debug, Clone)]
pub enum QueryState {
    /// Subscribed, nothing back yet.
    Loading,
    /// Rows arrived (or an error, which WE also reports as loaded).
    Rows(Arc<Vec<Value>>),
}

/// The cell a named query compiled to this pass — predeclared into `local`
/// before any query compiles so a sibling's `local.<name>` resolves
/// whichever order the node's queries are compiled in (WE's `forward`
/// accessors, which read the real signal once it exists). Until `set`
/// fills it the slot answers like a gated cell: `[]`, `Loaded` `false`.
#[derive(Debug, Default)]
pub struct QuerySlot(RwLock<Option<Arc<QueryCell>>>);

impl QuerySlot {
    /// Bind the slot to the cell this pass's compile produced.
    pub fn set(&self, cell: Arc<QueryCell>) {
        if let Ok(mut s) = self.0.write() {
            *s = Some(cell);
        }
    }

    /// This pass's compile gated — the slot answers empty again.
    pub fn clear(&self) {
        if let Ok(mut s) = self.0.write() {
            *s = None;
        }
    }

    /// The bound cell, if the query compiled this pass.
    pub fn cell(&self) -> Option<Arc<QueryCell>> {
        self.0.read().ok().and_then(|s| s.clone())
    }

    /// The bound cell's state — `Loading` (empty rows) while unbound.
    pub fn state(&self) -> QueryState {
        self.cell()
            .map(|cell| cell.state())
            .unwrap_or(QueryState::Loading)
    }
}

/// One cell in the pool — shared by every node asking the same question.
/// `names` are the `$queries` field names that compiled to it — data a
/// snapshot fallback answers by, never part of the key.
#[derive(Debug)]
pub struct QueryCell {
    pub key: QueryKey,
    pub ir: QueryIr,
    names: RwLock<Vec<Arc<str>>>,
    state: RwLock<QueryState>,
}

impl QueryCell {
    pub fn state(&self) -> QueryState {
        self.state
            .read()
            .map(|s| s.clone())
            .unwrap_or(QueryState::Loading)
    }

    /// Rows arrived — the caller bumps the pool's revision.
    pub fn fill(&self, state: QueryState) {
        if let Ok(mut s) = self.state.write() {
            *s = state;
        }
    }

    /// A `$queries` field name that compiled to this cell.
    pub fn note_name(&self, name: Arc<str>) {
        if let Ok(mut names) = self.names.write() {
            if !names.contains(&name) {
                names.push(name);
            }
        }
    }

    /// The first field name that compiled here — a snapshot's lookup key.
    pub fn first_name(&self) -> Option<Arc<str>> {
        self.names.read().ok()?.first().cloned()
    }
}

/// Where a cell's rows come from. E6/E7 answer from a real subscription;
/// the offline stage answers from the snapshot's `queries` table. `rows` is
/// the brief's signature — keyed by what is asked, never by who asked.
pub trait QuerySource {
    fn rows(&self, key: &QueryKey, ir: &QueryIr) -> QueryState;
}

/// The pool: `key → cell`, one cell per distinct question. The revision
/// bumps whenever a cell's state changes, so a frame watches it like the
/// bag's version.
#[derive(Default)]
pub struct QueryPool {
    cells: RwLock<HashMap<QueryKey, Arc<QueryCell>>>,
    revision: AtomicU64,
}

impl QueryPool {
    pub fn new() -> Self {
        Self::default()
    }

    /// The cell for `key`, creating it (Loading) on first sight.
    pub fn cell(&self, key: QueryKey, ir: QueryIr) -> Arc<QueryCell> {
        if let Some(cell) = self.cells.read().ok().and_then(|c| c.get(&key).cloned()) {
            return cell;
        }
        let mut cells = match self.cells.write() {
            Ok(c) => c,
            Err(_) => {
                return Arc::new(QueryCell {
                    key,
                    ir,
                    names: RwLock::new(Vec::new()),
                    state: RwLock::new(QueryState::Loading),
                });
            }
        };
        cells
            .entry(key.clone())
            .or_insert_with(|| {
                Arc::new(QueryCell {
                    key,
                    ir,
                    names: RwLock::new(Vec::new()),
                    state: RwLock::new(QueryState::Loading),
                })
            })
            .clone()
    }

    /// Data revision — one of the frame's counters.
    pub fn revision(&self) -> u64 {
        self.revision.load(Ordering::Relaxed)
    }

    /// A cell's state changed.
    pub fn bump(&self) {
        self.revision.fetch_add(1, Ordering::Relaxed);
    }

    /// Live keys — for a test counting distinct subscriptions.
    pub fn len(&self) -> usize {
        self.cells.read().map(|c| c.len()).unwrap_or(0)
    }

    /// No live keys.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// All cells — the runtime fills new ones after a resolve.
    pub fn cells(&self) -> Vec<Arc<QueryCell>> {
        self.cells
            .read()
            .map(|c| c.values().cloned().collect())
            .unwrap_or_default()
    }
}

/// The pull path's form of one `$queries` entry — what a pool cell is made
/// from. [`compiled_to_cell`] produces it from a [`Compiled`].
#[derive(Debug, Clone)]
pub struct CompiledQuery {
    /// Entity names after `entityNamesOf` — deduped, blanks dropped.
    /// E6's `QuerySource` turns them into the subscription's `ClassSel`.
    #[allow(dead_code)]
    pub entities: Vec<Arc<str>>,
    /// The entity came as a list — a union read even when it lists one.
    #[allow(dead_code)]
    pub union: bool,
    /// `subscribe` — default `true`; a one-shot still asks once.
    #[allow(dead_code)]
    pub subscribe: bool,
    /// The `when` gate evaluated true — a gated query's field still exists.
    pub ir: QueryIr,
    /// What the pool dedups on.
    pub key: QueryKey,
}

/// The pull adapter: `Ready` is a cell to make; `Provisional` and `Gated`
/// are no cell (the slot is cleared and answers `[]`/`false`). No mount
/// space yet, so `Here` keys as a dataset-less read.
pub fn compiled_to_cell(compiled: Compiled) -> Option<CompiledQuery> {
    match compiled {
        Compiled::Ready(request) => {
            let key = request.key(None);
            Some(CompiledQuery {
                entities: request.classes.to_vec(),
                union: request.union,
                subscribe: request.subscribe,
                ir: request.ir,
                key,
            })
        }
        Compiled::Provisional(_) | Compiled::Gated => None,
    }
}

/// Drop where-conditions whose operands did not resolve
/// (`pruneUnresolvedWhere`): only `Undefined` is unresolved — `null` is a
/// value ("equals null") and stays, an empty `not:` list is no condition and
/// drops, `OR`/`AND`/`NOT` recurse. `None` when nothing survives.
#[doc(hidden)] // public for the conformance vectors
pub fn prune_where(clause: &Value) -> Option<Json> {
    let Value::Obj(map) = clause else {
        return Some(clause.to_json());
    };
    let mut out = serde_json::Map::new();
    for (key, value) in map.iter() {
        if value.is_undefined() {
            continue;
        }
        match &**key {
            "OR" | "AND" => {
                let Value::List(branches) = value else {
                    continue;
                };
                let kept: Vec<Json> = branches
                    .iter()
                    .filter(|b| matches!(b, Value::Obj(_)))
                    .filter_map(prune_where)
                    .collect();
                if !kept.is_empty() {
                    out.insert(key.to_string(), Json::Array(kept));
                }
            }
            "NOT" => {
                if matches!(value, Value::Obj(_)) {
                    if let Some(pruned) = prune_where(value) {
                        out.insert(key.to_string(), pruned);
                    }
                }
            }
            _ => {
                if let Value::Obj(ops) = value {
                    let kept: Vec<(String, Json)> = ops
                        .iter()
                        .filter(|(op, operand)| {
                            if operand.is_undefined() {
                                return false;
                            }
                            // An empty `not: []` list prunes away — it is a
                            // hole the resolution left behind, not a filter.
                            op.as_ref() != "not"
                                || !matches!(operand, Value::List(l) if l.is_empty())
                        })
                        .map(|(op, operand)| (op.to_string(), operand.to_json()))
                        .collect();
                    if !kept.is_empty() {
                        out.insert(key.to_string(), Json::Object(kept.into_iter().collect()));
                    }
                } else {
                    out.insert(key.to_string(), value.to_json());
                }
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(Json::Object(out))
    }
}

/// Whether a resolved `scope` still names an anchor (`scopeIsAnchored`): a
/// LIST of anchors is anchored even when empty; an `anchorId` counts only
/// when it is not undefined/null/"".
#[doc(hidden)] // public for the conformance vectors
pub fn scope_anchored(scope: &Value) -> bool {
    let Value::Obj(map) = scope else {
        return false;
    };
    match map.get("anchorId") {
        Some(Value::List(_)) => true,
        Some(Value::Str(s)) => !s.is_empty(),
        Some(Value::Null) | Some(Value::Undefined) | None => false,
        Some(_) => true,
    }
}

/// The entity names a resolved `entity` asks for (`entityNamesOf`): a name
/// is one entity; a list — even of one, even empty — is a union. Anything
/// else is "not answered yet".
fn entity_names(value: &Value) -> Option<(Vec<Arc<str>>, bool)> {
    match value {
        Value::Str(name) if !name.is_empty() => Some((vec![name.clone()], false)),
        Value::List(items) => {
            let mut seen: Vec<Arc<str>> = Vec::new();
            for item in items.iter() {
                if let Value::Str(name) = item {
                    if !name.is_empty() && !seen.iter().any(|s| s == name) {
                        seen.push(name.clone());
                    }
                }
            }
            Some((seen, true))
        }
        _ => None,
    }
}

/// `Value` into the IR's raw JSON — `Undefined` and callables are absent.
fn to_ir_json(value: &Value) -> Option<Json> {
    match value {
        Value::Undefined | Value::Callable(_) => None,
        other => Some(other.to_json()),
    }
}

/// A JSON subtree with every `{"$":expr}` token evaluated and `undefined`
/// results re-encoded — `resolveQueryProp`'s deep resolve of `params`.
fn deep_resolve_json(
    raw: &Json,
    scope: &Scope,
    bag: &StoreBag,
    cache: &mut ParseCache,
    warnings: &mut Vec<Arc<str>>,
) -> Json {
    match raw {
        Json::Object(map) if map.len() == 1 && map.contains_key("$") => {
            eval_json(raw, scope, bag, cache, warnings).to_json()
        }
        Json::Object(map) => Json::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), deep_resolve_json(v, scope, bag, cache, warnings)))
                .collect(),
        ),
        Json::Array(items) => Json::Array(
            items
                .iter()
                .map(|v| deep_resolve_json(v, scope, bag, cache, warnings))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// `resolveQueryProp`: a `$query` object becomes a descriptor —
/// `{entity, params, subscribe, dataset, include?, when?}`. The named keys
/// carry their authored value through verbatim (`entity` stays a token when
/// it is one — entity resolution happens against the live scope at compile
/// time); every other key is a param and is deep-resolved. Absent `entity`
/// and `dataset` encode `undefined`; `subscribe` defaults `true`.
pub fn query_descriptor(
    query: &Json,
    scope: &Scope,
    bag: &StoreBag,
    cache: &mut ParseCache,
    warnings: &mut Vec<Arc<str>>,
) -> Option<Json> {
    let Json::Object(map) = query else {
        return None;
    };
    let undefined = || {
        let mut m = serde_json::Map::new();
        m.insert("$undefined".to_string(), Json::Bool(true));
        Json::Object(m)
    };
    let mut out = serde_json::Map::new();
    let mut params = serde_json::Map::new();
    for (key, raw) in map {
        match key.as_str() {
            "entity" | "dataset" | "include" | "when" => {
                out.insert(key.clone(), raw.clone());
            }
            "subscribe" => {}
            _ => {
                params.insert(
                    key.clone(),
                    deep_resolve_json(raw, scope, bag, cache, warnings),
                );
            }
        }
    }
    out.entry("entity").or_insert_with(undefined);
    out.entry("dataset").or_insert_with(undefined);
    out.insert("params".to_string(), Json::Object(params));
    out.insert(
        "subscribe".to_string(),
        Json::Bool(match map.get("subscribe") {
            None => true,
            Some(Json::Bool(b)) => *b,
            Some(other) => eval_json(other, scope, bag, cache, warnings).truthy(),
        }),
    );
    Some(Json::Object(out))
}

/// Compile one `$queries` entry against `scope` for the pull path —
/// [`compile_request`] through [`compiled_to_cell`]. `None` → no cell: the
/// field exists, its rows are `[]` and its `Loaded` flag reads `false`.
pub fn compile_query(
    query: &Json,
    scope: &Scope,
    bag: &StoreBag,
    cache: &mut ParseCache,
    warnings: &mut Vec<Arc<str>>,
) -> Option<CompiledQuery> {
    compiled_to_cell(compile_request(
        query,
        scope,
        &mut CompileCx::new(bag, cache, warnings),
    ))
}

/// Compile one `$queries` entry against `scope` into a typed request.
/// `Gated` is the answer a `when`-false, an unresolved entity, or an
/// unresolved bound gives in WE before the first rows land.
pub fn compile_request(query: &Json, scope: &Scope, cx: &mut CompileCx) -> Compiled {
    match compile_inner(query, scope, cx.bag, cx.cache, cx.warnings) {
        Some(request) => Compiled::Ready(request),
        None => Compiled::Gated,
    }
}

fn compile_inner(
    query: &Json,
    scope: &Scope,
    bag: &StoreBag,
    cache: &mut ParseCache,
    warnings: &mut Vec<Arc<str>>,
) -> Option<QueryRequest> {
    let descriptor = query_descriptor(query, scope, bag, cache, warnings)?;
    let Json::Object(map) = &descriptor else {
        return None;
    };

    // `when`: falsy → the query is not asked at all.
    if let Some(when) = map.get("when") {
        let met = eval_json(when, scope, bag, cache, warnings);
        if !met.truthy() {
            return None;
        }
    }

    // `entity` — a name, a list, or an expression answering either.
    let (entities, union) = map
        .get("entity")
        .and_then(|e| entity_names(&eval_json(e, scope, bag, cache, warnings)))?;

    // `params` — the descriptor's resolved params; the IR keeps the keys it
    // models and stows the rest in `extra` so the pool key stays honest.
    let mut ir = QueryIr::default();
    let mut bound_gated = false;
    if let Some(Json::Object(params)) = map.get("params") {
        for (key, raw) in params {
            let authored = !raw.is_null();
            let resolved = eval_json(raw, scope, bag, cache, warnings);
            match key.as_str() {
                "where" => ir.where_ = prune_where(&resolved),
                "order" => ir.order = to_ir_json(&resolved),
                "limit" | "offset" => {
                    // An authored bound that did not resolve gates the read —
                    // `unresolvedBound` waits rather than widening it.
                    let n = match &resolved {
                        Value::Num(n) if *n >= 0.0 => Some(*n as u64),
                        Value::Str(s) => s
                            .parse::<f64>()
                            .ok()
                            .filter(|n| *n >= 0.0)
                            .map(|n| n as u64),
                        _ => None,
                    };
                    match (key.as_str(), n) {
                        ("limit", Some(n)) => ir.limit = Some(n),
                        ("offset", Some(n)) => ir.offset = Some(n),
                        _ => {}
                    }
                    if authored && n.is_none() {
                        bound_gated = true;
                    }
                }
                "scope" => {
                    // An unanchored scope widens instead of gating — the
                    // deliberate asymmetry `scopeIsAnchored` documents.
                    if scope_anchored(&resolved) {
                        ir.scope = to_ir_json(&resolved);
                    }
                }
                "select" => {
                    if let Value::List(items) = &resolved {
                        ir.select = Some(
                            items
                                .iter()
                                .filter_map(|i| match i {
                                    Value::Str(s) => Some(s.to_string()),
                                    _ => None,
                                })
                                .collect(),
                        );
                    }
                }
                other if RESERVED_IR_KEYS.contains(&other) => {
                    let message: Arc<str> = format!(
                        "$query param `{other}` is reserved — a dataset is chosen \
                         with `dataset`; the query is not asked"
                    )
                    .into();
                    if !warnings.iter().any(|w| w == &message) {
                        warnings.push(message);
                    }
                    return None;
                }
                other => {
                    if let Some(v) = to_ir_json(&resolved) {
                        ir.extra.insert(other.to_string(), v);
                    }
                }
            }
        }
    }
    if bound_gated {
        return None;
    }

    if let Some(include) = map.get("include") {
        ir.include = to_ir_json(&eval_json(include, scope, bag, cache, warnings));
    }
    let mut dataset_sel = DatasetSel::Here;
    if let Some(dataset) = map.get("dataset") {
        let resolved = match dataset {
            Json::Object(d) if d.get("$").and_then(|s| s.as_str()).is_some() => eval_str(
                d["$"].as_str().unwrap_or_default(),
                scope,
                bag,
                cache,
                warnings,
            ),
            Json::String(s) => Value::Str(s.as_str().into()),
            other => Value::from_json(other),
        };
        if !matches!(resolved, Value::Undefined | Value::Null) {
            dataset_sel = DatasetSel::Named(DatasetHandle::new(resolved.js_string()));
        }
    }

    let subscribe = match map.get("subscribe") {
        None => true,
        Some(Json::Bool(b)) => *b,
        Some(other) => eval_json(other, scope, bag, cache, warnings).truthy(),
    };

    Some(QueryRequest {
        classes: entities.into(),
        union,
        subscribe,
        dataset: dataset_sel,
        ir,
        name_hint: None,
    })
}
