//! Live store members: the store map's `modelRead` rows (task M2) served by
//! executor reads instead of the recorded snapshot.
//!
//! A row is data (`data/storemap-live.json`): the query the TS store runs,
//! how its rows become the member's value (`pick`), the value before the
//! first answer (`initial`), and an optional `loaded` flag member. Rows that
//! read something other than a model (`native`: the agent, a
//! neighbourhood's members) name a built-in instead of a query.
//!
//! [`LiveMembers::install`] wraps each affected store root in a [`LiveNs`]:
//! a member with a row answers from its cell; everything else falls through
//! to the root underneath — the snapshot, or a derived native — exactly as
//! offline. Each row's read runs on the connection's runtime; an answer
//! writes the cell and re-binds the store root, which moves the bag's data
//! revision and wakes the session. A live row is a `modelSubscribe`, so it
//! keeps following the executor (and re-opens after a reconnect).
//!
//! Before its first answer a live member reads `initial` — the TS store's
//! own empty value — never the snapshot's, which belongs to another space.
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock, Weak};

use ad4m_client::model::Model;
use indexmap::IndexMap;
use serde_json::{json, Map, Value as Json};
use we_data::{MemberKind, Provenance, StoreBag, StoreMap};
use we_expr::{Namespace, Value};
use we_template::QueryIr;

use crate::connection::Connection;
use crate::relations::Relations;
use crate::source::SpaceBinding;

const LIVE_MAP: &str = include_str!("../data/storemap-live.json");

/// One live row.
#[derive(Debug, Clone)]
pub struct LiveRow {
    /// `store.member`.
    pub path: String,
    pub read: Read,
    /// Follow the executor (`modelSubscribe`) or ask once.
    pub live: bool,
    pub initial: Json,
    /// A flag member that turns true with the first answer.
    pub loaded: Option<String>,
}

/// What a row reads.
#[derive(Debug, Clone)]
pub enum Read {
    /// A model read and how its rows become the value.
    Model {
        entity: String,
        query: Box<QueryIr>,
        /// `where: { "$self": true }` — the space's own record
        /// (`spaceSelfWhere`: by neighbourhood URL when shared, else uuid).
        self_where: bool,
        pick: Pick,
    },
    /// A built-in that is not a model read.
    Native(String),
}

/// How rows become a member's value.
#[derive(Debug, Clone, PartialEq)]
pub enum Pick {
    /// The rows as they are.
    Rows,
    /// The first row, or `initial`.
    First,
    /// A field of the first row; a relation's id when it is hydrated.
    FirstField(String),
    /// A named reducer for what a store maps its rows into.
    Named(String),
}

/// The live rows, plus the derived rows the offline loader applies.
#[derive(Debug, Clone)]
pub struct LiveMap {
    pub rows: Vec<LiveRow>,
    /// The `derived` rows, as a store map the offline loader takes.
    pub derived: StoreMap,
}

impl LiveMap {
    /// The rows shipped in `data/storemap-live.json`.
    pub fn bundled() -> Self {
        Self::parse(LIVE_MAP).expect("data/storemap-live.json parses")
    }

    pub fn parse(text: &str) -> Result<Self, String> {
        let map = StoreMap::parse(text)?;
        let mut rows = Vec::new();
        let mut derived = StoreMap {
            version: map.version,
            screen: map.screen.clone(),
            members: BTreeMap::new(),
        };
        for (path, row) in &map.members {
            match row.kind {
                MemberKind::ModelRead => rows.push(parse_row(path, &row.raw)?),
                MemberKind::Derived => {
                    derived.members.insert(path.clone(), row.clone());
                }
                _ => {}
            }
        }
        Ok(Self { rows, derived })
    }

    /// Every member a live row answers, its `loaded` flags included.
    pub fn members(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for row in &self.rows {
            out.push(row.path.clone());
            out.extend(row.loaded.clone());
        }
        out
    }
}

fn parse_row(path: &str, raw: &Map<String, Json>) -> Result<LiveRow, String> {
    let err = |m: &str| format!("live map: member {path}: {m}");
    let read = if let Some(native) = raw.get("native").and_then(Json::as_str) {
        Read::Native(native.to_string())
    } else {
        let Some(Json::Object(q)) = raw.get("query") else {
            return Err(err("a modelRead row needs a query object or a native"));
        };
        let entity = q
            .get("entity")
            .and_then(Json::as_str)
            .ok_or_else(|| err("query.entity"))?
            .to_string();
        let mut q = q.clone();
        q.remove("entity");
        let self_where = match q.get_mut("where") {
            Some(Json::Object(w)) => w.remove("$self").is_some(),
            _ => false,
        };
        if matches!(q.get("where"), Some(Json::Object(w)) if w.is_empty()) {
            q.remove("where");
        }
        let query: QueryIr =
            serde_json::from_value(Json::Object(q)).map_err(|e| err(&e.to_string()))?;
        let pick = match raw.get("pick").and_then(Json::as_str).unwrap_or("rows") {
            "rows" => Pick::Rows,
            "first" => Pick::First,
            p if p.starts_with("first.") => Pick::FirstField(p["first.".len()..].to_string()),
            p if NAMED_PICKS.contains(&p) => Pick::Named(p.to_string()),
            p => return Err(err(&format!("unknown pick {p:?}"))),
        };
        Read::Model {
            entity,
            query: Box::new(query),
            self_where,
            pick,
        }
    };
    if let Read::Native(n) = &read {
        if !NATIVES.contains(&n.as_str()) {
            return Err(err(&format!("unknown native {n:?}")));
        }
    }
    Ok(LiveRow {
        path: path.to_string(),
        read,
        live: raw.get("live").and_then(Json::as_bool).unwrap_or(false),
        initial: raw.get("initial").cloned().unwrap_or(Json::Null),
        loaded: raw.get("loaded").and_then(Json::as_str).map(str::to_string),
    })
}

const NAMED_PICKS: &[&str] = &["landmarksByName", "taskStates", "involvementTypes"];
const NATIVES: &[&str] = &["agent.me", "neighbourhood.memberDids"];

// ── The namespace ──

#[derive(Debug)]
struct Cell {
    value: RwLock<Value>,
    answered: AtomicBool,
}

/// A store root with live members over the root it replaced.
#[derive(Debug)]
struct LiveNs {
    store: Arc<str>,
    cells: IndexMap<Arc<str>, Arc<Cell>>,
    base: Value,
    provenance: Provenance,
}

impl Namespace for LiveNs {
    fn get(&self, key: &str) -> Value {
        let Some(cell) = self.cells.get(key) else {
            return member_get(&self.base, key);
        };
        if cell.answered.load(Ordering::Acquire) {
            self.provenance.note_live(format!("{}.{}", self.store, key));
        }
        cell.value
            .read()
            .map(|v| v.clone())
            .unwrap_or(Value::Undefined)
    }

    fn keys(&self) -> Vec<Arc<str>> {
        let mut keys = match &self.base {
            Value::Namespace(ns) => ns.keys(),
            Value::Obj(map) => map.keys().cloned().collect(),
            _ => vec![],
        };
        for k in self.cells.keys() {
            if !keys.contains(k) {
                keys.push(k.clone());
            }
        }
        keys
    }
}

/// `me` — the `$me` global — reads `sessionStore.me` out of the bag at
/// read time, so a live `sessionStore.me` is what `me.did` sees.
#[derive(Debug)]
struct MeAlias(Weak<StoreBag>);

impl Namespace for MeAlias {
    fn get(&self, key: &str) -> Value {
        let Some(bag) = self.0.upgrade() else {
            return Value::Undefined;
        };
        let session = bag.root("sessionStore").unwrap_or(Value::Undefined);
        member_get(&member_get(&session, "me"), key)
    }
}

fn member_get(container: &Value, key: &str) -> Value {
    match container {
        Value::Namespace(ns) => ns.get(key),
        Value::Obj(map) => map.get(key).cloned().unwrap_or(Value::Undefined),
        _ => Value::Undefined,
    }
}

// ── Installing ──

/// The installed live layer: which members it answers, and the tasks
/// reading them (stopped when this drops).
pub struct LiveMembers {
    members: Vec<String>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

impl Drop for LiveMembers {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
    }
}

impl LiveMembers {
    /// Wrap the stores `map` touches and start every row's read against
    /// `space` on `conn`.
    pub fn install(
        bag: &Arc<StoreBag>,
        provenance: &Provenance,
        map: &LiveMap,
        conn: &Connection,
        space: &SpaceBinding,
        shared_url: Option<&str>,
    ) -> Self {
        // One cell per member (and per loaded flag), grouped by store.
        let mut by_store: IndexMap<String, IndexMap<Arc<str>, Arc<Cell>>> = IndexMap::new();
        let mut cell_for = |path: &str, initial: Value| -> (String, Arc<Cell>) {
            let (store, member) = path.rsplit_once('.').unwrap_or((path, ""));
            let cell = Arc::new(Cell {
                value: RwLock::new(initial),
                answered: AtomicBool::new(false),
            });
            by_store
                .entry(store.to_string())
                .or_default()
                .insert(member.into(), cell.clone());
            (store.to_string(), cell)
        };
        let mut plans = Vec::new();
        for row in &map.rows {
            let (store, cell) = cell_for(&row.path, Value::from_json(&row.initial));
            let loaded = row
                .loaded
                .as_deref()
                .map(|p| cell_for(p, Value::Bool(false)).1);
            plans.push((row.clone(), store, cell, loaded));
        }
        // Wrap each store over whatever root it has now.
        let mut roots: BTreeMap<String, Value> = BTreeMap::new();
        for (store, cells) in by_store {
            let base = bag.root(&store).unwrap_or(Value::Undefined);
            let ns = Value::Namespace(Arc::new(LiveNs {
                store: store.as_str().into(),
                cells,
                base,
                provenance: provenance.clone(),
            }));
            bag.set_root(&store, ns.clone());
            roots.insert(store, ns);
        }
        if roots.contains_key("sessionStore") {
            bag.set_root(
                "me",
                Value::Namespace(Arc::new(MeAlias(Arc::downgrade(bag)))),
            );
        }
        let relations = Relations::core();
        let mut tasks = Vec::new();
        for (row, store, cell, loaded) in plans {
            let answer = Answer {
                bag: Arc::downgrade(bag),
                store: store.clone(),
                root: roots[&store].clone(),
                cell,
                loaded,
                initial: row.initial.clone(),
            };
            let task = match &row.read {
                Read::Model {
                    entity,
                    query,
                    self_where,
                    pick,
                } => {
                    let mut ir = (**query).clone();
                    if *self_where {
                        let w = match shared_url {
                            Some(url) => json!({ "url": url }),
                            None => json!({ "uuid": space.uuid }),
                        };
                        ir.where_ = Some(merge_where(ir.where_.take(), w));
                    }
                    let q = match crate::translate::model_query(&ir, &relations) {
                        Ok(q) => q,
                        Err(e) => {
                            log::warn!("we-ad4m: live row {}: {e}", row.path);
                            continue;
                        }
                    };
                    let model = Model::new(conn.ws(), space.uuid.clone(), entity.clone());
                    let pick = pick.clone();
                    let path = row.path.clone();
                    let live = row.live;
                    conn.spawn(async move {
                        if !live {
                            match model.query(&q).await {
                                Ok(r) => {
                                    answer.set(&apply_pick(&pick, r.instances, &answer.initial));
                                }
                                Err(e) => answer.fail(&path, e),
                            }
                            return;
                        }
                        let mut sub = match model.subscribe(&q).await {
                            Ok(s) => s,
                            Err(e) => return answer.fail(&path, e),
                        };
                        while let Some(r) = sub.next().await {
                            if !answer.set(&apply_pick(&pick, r.instances, &answer.initial)) {
                                break;
                            }
                        }
                        sub.dispose().await;
                    })
                }
                Read::Native(name) => {
                    let name = name.clone();
                    let conn2 = conn.clone();
                    let uuid = space.uuid.clone();
                    let path = row.path.clone();
                    conn.spawn(async move {
                        match run_native(&name, &conn2, &uuid).await {
                            Ok(v) => {
                                answer.set(&v);
                            }
                            Err(e) => answer.fail(&path, e),
                        }
                    })
                }
            };
            tasks.push(task);
        }
        Self {
            members: map.members(),
            tasks,
        }
    }

    /// The members this layer answers.
    pub fn members(&self) -> &[String] {
        &self.members
    }
}

/// Where one row's answers go.
struct Answer {
    bag: Weak<StoreBag>,
    store: String,
    root: Value,
    cell: Arc<Cell>,
    loaded: Option<Arc<Cell>>,
    initial: Json,
}

impl Answer {
    /// Write the value and re-bind the store root, which moves the data
    /// revision and wakes the session. `false` once the bag is gone.
    fn set(&self, value: &Json) -> bool {
        let Some(bag) = self.bag.upgrade() else {
            return false;
        };
        if let Ok(mut v) = self.cell.value.write() {
            *v = Value::from_json(value);
        }
        self.cell.answered.store(true, Ordering::Release);
        if let Some(flag) = &self.loaded {
            if let Ok(mut v) = flag.value.write() {
                *v = Value::Bool(true);
            }
            flag.answered.store(true, Ordering::Release);
        }
        bag.set_root(&self.store, self.root.clone());
        true
    }
}

impl Answer {
    /// The read failed: settle on `initial`, loaded — what the TS store
    /// does (`finally { setLoaded(true) }` over its empty value), so a
    /// template's "loaded and empty" branch shows rather than a spinner
    /// that never ends.
    fn fail(&self, path: &str, e: anyhow::Error) {
        log::warn!("we-ad4m: live row {path}: {e:#}");
        self.set(&self.initial.clone());
    }
}

fn merge_where(base: Option<Json>, add: Json) -> Json {
    match (base, add) {
        (Some(Json::Object(mut b)), Json::Object(a)) => {
            b.extend(a);
            Json::Object(b)
        }
        (_, add) => add,
    }
}

async fn run_native(name: &str, conn: &Connection, uuid: &str) -> anyhow::Result<Json> {
    let client = conn.client();
    let uuid = uuid.to_string();
    let name = name.to_string();
    conn.run(async move {
        match name.as_str() {
            "agent.me" => {
                let me = client.agent.me().await?;
                Ok(json!({ "did": me.did }))
            }
            "neighbourhood.memberDids" => {
                let me = client.agent.me().await?.did;
                // A local perspective has no neighbourhood: just me.
                let mut dids = client
                    .neighbourhoods
                    .other_agents(uuid)
                    .await
                    .unwrap_or_default();
                if !dids.contains(&me) {
                    dids.insert(0, me);
                }
                Ok(json!(dids))
            }
            other => anyhow::bail!("unknown native {other}"),
        }
    })
    .await
}

// ── Picks ──

/// A row's rows as its member's value.
pub fn apply_pick(pick: &Pick, rows: Vec<Json>, initial: &Json) -> Json {
    match pick {
        Pick::Rows => Json::Array(rows),
        Pick::First => rows.into_iter().next().unwrap_or_else(|| initial.clone()),
        Pick::FirstField(field) => rows
            .first()
            .and_then(|r| r.get(field))
            .map(relation_id)
            .unwrap_or_else(|| initial.clone()),
        Pick::Named(name) => match name.as_str() {
            "landmarksByName" => landmarks_by_name(&rows),
            "taskStates" => task_states(rows),
            "involvementTypes" => involvement_types(rows),
            _ => initial.clone(),
        },
    }
}

/// `relationId`: an id string as it is, a hydrated record's `id`, a list's
/// first.
fn relation_id(v: &Json) -> Json {
    match v {
        Json::String(_) => v.clone(),
        Json::Object(o) => o.get("id").cloned().unwrap_or(Json::from("")),
        Json::Array(a) => a.first().map(relation_id).unwrap_or(Json::from("")),
        _ => Json::from(""),
    }
}

fn text(v: Option<&Json>) -> String {
    v.and_then(Json::as_str).unwrap_or_default().to_string()
}

fn stamp(row: &Json) -> String {
    match row.get("createdAt").or_else(|| row.get("timestamp")) {
        Some(Json::String(s)) => s.clone(),
        Some(Json::Number(n)) => format!("{:020}", n.as_f64().unwrap_or(0.0) as u64),
        _ => String::new(),
    }
}

/// `landmarksByName`: name → node id, the newest of two of one name.
fn landmarks_by_name(rows: &[Json]) -> Json {
    let mut by_name: BTreeMap<String, (String, String)> = BTreeMap::new();
    for r in rows {
        let name = text(r.get("name"));
        let node = relation_id(r.get("node").unwrap_or(&Json::Null));
        let node = node.as_str().unwrap_or_default().to_string();
        if name.is_empty() || node.is_empty() {
            continue;
        }
        let at = stamp(r);
        match by_name.get(&name) {
            Some((_, prev)) if *prev >= at => {}
            _ => {
                by_name.insert(name, (node, at));
            }
        }
    }
    Json::Object(
        by_name
            .into_iter()
            .map(|(k, (id, _))| (k, Json::from(id)))
            .collect(),
    )
}

/// `deriveSlug`: lower case, runs of anything else a single `-`.
fn derive_slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

/// `applyTaskStates` + the `taskStates` memo: one view per slug, in the
/// semantic reading order (open, active, blocked, done, cancelled).
fn task_states(rows: Vec<Json>) -> Json {
    let rank = |s: &str| match s {
        "active" => 1,
        "blocked" => 2,
        "done" => 3,
        "cancelled" => 4,
        _ => 0,
    };
    let mut seen = std::collections::HashSet::new();
    let mut views: Vec<Json> = Vec::new();
    for r in &rows {
        let name = text(r.get("name"));
        let slug = match text(r.get("slug")) {
            s if s.is_empty() => derive_slug(&name),
            s => s,
        };
        if !seen.insert(slug.clone()) {
            continue;
        }
        let semantic = match text(r.get("semantic")) {
            s if s.is_empty() => "open".to_string(),
            s => s,
        };
        let approvals = r
            .get("approvals")
            .and_then(Json::as_u64)
            .filter(|n| *n >= 1)
            .unwrap_or(1);
        views.push(json!({
            "id": r.get("id").cloned().unwrap_or(Json::from("")),
            "name": if name.is_empty() { slug.clone() } else { name },
            "slug": slug,
            "semantic": semantic,
            "color": text(r.get("color")),
            "icon": text(r.get("icon")),
            "retired": r.get("retired").and_then(Json::as_bool).unwrap_or(false),
            "approvals": approvals,
            "approverKind": text(r.get("approverKind")),
            "evidence": [],
        }));
    }
    views.sort_by_key(|v| rank(v["semantic"].as_str().unwrap_or_default()));
    Json::Array(views)
}

/// `loadInvolvementTypes`: sorted by creation, mapped to views.
fn involvement_types(mut rows: Vec<Json>) -> Json {
    const SEMANTICS: &[&str] = &[
        "responsible",
        "reviewing",
        "committed",
        "interested",
        "declined",
    ];
    rows.sort_by_key(stamp);
    Json::Array(
        rows.iter()
            .map(|r| {
                let name = text(r.get("name"));
                let slug = match text(r.get("slug")) {
                    s if s.is_empty() => derive_slug(&name),
                    s => s,
                };
                let semantic = text(r.get("semantic"));
                let applies: Vec<Json> = text(r.get("appliesTo"))
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(Json::from)
                    .collect();
                json!({
                    "id": r.get("id").cloned().unwrap_or(Json::from("")),
                    "name": if name.is_empty() { slug.clone() } else { name },
                    "slug": slug,
                    "semantic": if SEMANTICS.contains(&semantic.as_str()) { semantic } else { "responsible".into() },
                    "reflexive": r.get("reflexive").and_then(Json::as_bool).unwrap_or(false),
                    "appliesTo": applies,
                    "icon": text(r.get("icon")),
                    "color": text(r.get("color")),
                    "retired": r.get("retired").and_then(Json::as_bool).unwrap_or(false),
                })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_map_parses_and_splits() {
        let map = LiveMap::bundled();
        let paths: Vec<&str> = map.rows.iter().map(|r| r.path.as_str()).collect();
        assert!(paths.contains(&"spaceStore.root"));
        assert!(paths.contains(&"sessionStore.me"));
        assert!(map
            .derived
            .members
            .contains_key("spaceStore.offeredTaskStates"));
        // modelRead rows never reach the offline loader.
        assert!(!map.derived.members.contains_key("spaceStore.root"));
        assert!(map
            .members()
            .contains(&"spaceStore.landmarksLoaded".to_string()));
        let current = map
            .rows
            .iter()
            .find(|r| r.path == "spaceStore.currentSpace")
            .unwrap();
        match &current.read {
            Read::Model {
                entity,
                self_where,
                query,
                ..
            } => {
                assert_eq!(entity, "Space");
                assert!(self_where);
                assert!(query.where_.is_none(), "$self is lifted out of where");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn unknown_pick_and_native_are_refused() {
        let bad =
            r#"{"members":{"a.b":{"kind":"modelRead","query":{"entity":"X"},"pick":"nope"}}}"#;
        assert!(LiveMap::parse(bad).unwrap_err().contains("nope"));
        let bad = r#"{"members":{"a.b":{"kind":"modelRead","native":"nope"}}}"#;
        assert!(LiveMap::parse(bad).unwrap_err().contains("nope"));
    }

    #[test]
    fn root_is_the_relation_id() {
        let rows = vec![json!({ "id": "s1", "root": "c1" })];
        assert_eq!(
            apply_pick(&Pick::FirstField("root".into()), rows, &json!("")),
            json!("c1")
        );
        let rows = vec![json!({ "id": "s1", "root": { "id": "c2" } })];
        assert_eq!(
            apply_pick(&Pick::FirstField("root".into()), rows, &json!("")),
            json!("c2")
        );
        assert_eq!(
            apply_pick(&Pick::FirstField("root".into()), vec![], &json!("")),
            json!("")
        );
    }

    #[test]
    fn landmarks_newest_wins() {
        let rows = vec![
            json!({ "name": "board", "node": "b1", "createdAt": "2026-01-01" }),
            json!({ "name": "board", "node": "b2", "createdAt": "2026-02-01" }),
            json!({ "name": "canvas", "node": "c1", "createdAt": "2026-01-01" }),
            json!({ "name": "", "node": "x" }),
        ];
        assert_eq!(
            landmarks_by_name(&rows),
            json!({ "board": "b2", "canvas": "c1" })
        );
    }

    #[test]
    fn task_states_default_dedupe_and_order() {
        let rows = vec![
            json!({ "id": "1", "name": "Done", "slug": "done", "semantic": "done" }),
            json!({ "id": "2", "name": "In Review" }),
            json!({ "id": "3", "name": "Doing", "slug": "doing", "semantic": "active", "approvals": 0 }),
            json!({ "id": "4", "name": "Done again", "slug": "done" }),
        ];
        let v = task_states(rows);
        let slugs: Vec<&str> = v
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["slug"].as_str().unwrap())
            .collect();
        assert_eq!(slugs, ["in-review", "doing", "done"]);
        assert_eq!(v[0]["semantic"], json!("open"));
        assert_eq!(v[1]["approvals"], json!(1));
    }

    #[test]
    fn involvement_types_sorted_and_mapped() {
        let rows = vec![
            json!({ "id": "b", "name": "Going", "semantic": "committed", "reflexive": true, "createdAt": "2026-02" }),
            json!({ "id": "a", "name": "Assigned", "semantic": "odd", "appliesTo": "TaskBlock, EventBlock", "createdAt": "2026-01" }),
        ];
        let v = involvement_types(rows);
        assert_eq!(v[0]["slug"], json!("assigned"));
        assert_eq!(v[0]["semantic"], json!("responsible"));
        assert_eq!(v[0]["appliesTo"], json!(["TaskBlock", "EventBlock"]));
        assert_eq!(v[1]["reflexive"], json!(true));
    }

    /// A live member reads its cell — `initial` before an answer, never the
    /// snapshot under it — and every other member falls through.
    #[test]
    fn live_ns_answers_owned_members_and_falls_through() {
        let provenance = Provenance::new();
        let base = Value::from_json(&json!({ "root": "snapshot-root", "members": ["m"] }));
        let cell = Arc::new(Cell {
            value: RwLock::new(Value::Str("".into())),
            answered: AtomicBool::new(false),
        });
        let ns = LiveNs {
            store: "spaceStore".into(),
            cells: IndexMap::from([(Arc::<str>::from("root"), cell.clone())]),
            base,
            provenance: provenance.clone(),
        };
        assert_eq!(ns.get("root").to_json(), json!(""));
        assert!(provenance.report().live_served.is_empty());
        assert_eq!(ns.get("members").to_json(), json!(["m"]));
        *cell.value.write().unwrap() = Value::Str("c1".into());
        cell.answered.store(true, Ordering::Release);
        assert_eq!(ns.get("root").to_json(), json!("c1"));
        assert_eq!(
            provenance.report().live_served,
            vec!["spaceStore.root".to_string()]
        );
    }
}
