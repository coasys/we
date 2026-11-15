//! [`OfflineData`]: the one entry point E6 adds — a recorded snapshot, plus an
//! optional [`StoreMap`], becomes the `Arc<StoreBag>` a `Session` resolves
//! against, and a [`Provenance`] handle that says where every read came from.
//!
//! What `from_snapshot` does, in order:
//!
//! 1. `StoreBag::from_snapshot` builds the bag (`stores` → root namespaces,
//!    `queries` → the static table, `invokes` → canned replies).
//! 2. Every store root is wrapped in a [`RecordingNs`] so a member read that
//!    the snapshot answers lands in the provenance's snapshot set. Members
//!    the screen owns (`routeStore.params`, `spaceStore.spacePath`, …) never
//!    reach it — `bind_screen`'s overlay answers first, as it should.
//! 3. `me` is aliased to `sessionStore.me` when the snapshot has no `me`
//!    store of its own — WE's `$me` is `sessionStore.me()`, so `me.did`
//!    records `sessionStore.me`.
//! 4. The nine host functions are registered on `set_function`; a call is
//!    noted `name()` in the native set.
//! 5. The store map's `derived`/`modelRead` rows that carry an
//!    implementation (`native` or `expr`) overlay their store — the member
//!    is served by the implementation and noted native; everything else on
//!    the store still records through the `RecordingNs` underneath. A row
//!    with no implementation falls back to the snapshot, as does a member
//!    with no row.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_template::{QuerySource, StoreBag};

use crate::natives::{named_native, register_host_functions};
use crate::provenance::{member_get, MeNs, MemberImpl, OverlayNs, Provenance, RecordingNs};
use crate::query_source::SnapshotQuerySource;
use crate::route::{RouteCaptures, RouteQuerySource};
use crate::storemap::{split_member, MemberKind, StoreMap};
use crate::{FakeExecutor, SpaceId};

/// `bag + provenance` — what a `Session` needs to resolve a snapshot offline,
/// and the record of who served what while it did.
#[derive(Debug)]
pub struct OfflineData {
    /// The store bag — `Session::new`'s `bag` argument.
    pub bag: Arc<StoreBag>,
    /// Snapshot-served members, native-served members, dropped calls.
    pub provenance: Provenance,
    /// The snapshot's `queries` table, name → raw rows value — the fixture an
    /// [`OfflineData::executor`] answers `model_query`/`model_subscribe` from.
    pub queries: IndexMap<String, Value>,
    /// The space the snapshot speaks for — `meta.dataset` when the file
    /// declares it, else the `spaceStore.spacePath` member's `/space/<id>`
    /// suffix. `None` means the snapshot names no space.
    space: Option<SpaceId>,
    /// The route's captures when built by [`OfflineData::from_route`].
    captures: Option<Arc<RouteCaptures>>,
}

impl OfflineData {
    /// Build the bag from a snapshot document of the shape
    /// `StoreBag::from_snapshot` reads, overlaying the store map's
    /// implementations when one is given.
    pub fn from_snapshot(
        json: &serde_json::Value,
        store_map: Option<&StoreMap>,
    ) -> Result<OfflineData, String> {
        validate_snapshot(json)?;
        let queries = query_table(json);
        let space = snapshot_space(json);
        Self::build(json, store_map, queries, space, None)
    }

    /// One route of a `we-snapshot@2` recording: the bag is that route's
    /// `members` (its `agents` joined into `profileStore.profiles` where the
    /// members lack them) and its declared `invokeTargets`; its queries are
    /// answered from that route's captures, bound by dataset + request —
    /// the flat `stores`/`queries` tables are never consulted, so a value
    /// the route did not record stays absent rather than borrowed from
    /// another route.
    pub fn from_route(
        json: &serde_json::Value,
        route: &str,
        store_map: Option<&StoreMap>,
    ) -> Result<OfflineData, String> {
        validate_snapshot(json)?;
        if crate::route::format(json)?.is_none() {
            return Err(format!(
                "snapshot: routes.{route} needs meta.format {:?}",
                crate::route::FORMAT_V2
            ));
        }
        let capture = json
            .get("routes")
            .and_then(|r| r.get(route))
            .ok_or_else(|| format!("snapshot: no routes.{route}"))?;
        let space = snapshot_space(json);
        let mut stores = capture
            .get("members")
            .and_then(|m| m.as_object())
            .cloned()
            .unwrap_or_default();
        join_agents(&mut stores, capture.get("agents"));
        let invokes: serde_json::Map<String, serde_json::Value> = capture
            .get("invokeTargets")
            .and_then(|t| t.as_array())
            .map(|targets| {
                targets
                    .iter()
                    .filter_map(|t| t.as_str())
                    .map(|t| (t.to_string(), serde_json::Value::Null))
                    .collect()
            })
            .unwrap_or_default();
        let doc = serde_json::json!({ "stores": stores, "invokes": invokes });
        let captures = Arc::new(RouteCaptures::parse(route, capture, space.clone())?);
        Self::build(&doc, store_map, IndexMap::new(), space, Some(captures))
    }

    fn build(
        json: &serde_json::Value,
        store_map: Option<&StoreMap>,
        queries: IndexMap<String, Value>,
        space: Option<SpaceId>,
        captures: Option<Arc<RouteCaptures>>,
    ) -> Result<OfflineData, String> {
        let bag = Arc::new(StoreBag::from_snapshot(json)?);
        let provenance = Provenance::new();

        // 1. Record reads against every snapshot store root.
        if let Some(stores) = json.get("stores").and_then(|s| s.as_object()) {
            for name in stores.keys() {
                if let Some(root) = bag.root(name) {
                    bag.set_root(name, RecordingNs::wrap(name, root, &provenance));
                }
            }
        }

        // 2. `me` — the `$me` host global — reads `sessionStore.me` through
        // its recording wrapper. A snapshot `me` store wins if it exists.
        let has_me_store = json
            .get("stores")
            .and_then(|s| s.as_object())
            .is_some_and(|s| s.contains_key("me"));
        if !has_me_store {
            if let Some(session) = bag.root("sessionStore") {
                bag.set_root("me", MeNs::wrap(session));
            }
        }

        // 3. The bundle's host functions.
        register_host_functions(&bag, &provenance);

        // 4. Store-map overlays.
        if let Some(map) = store_map {
            apply_store_map(&bag, map, &provenance)?;
        }

        Ok(OfflineData {
            bag,
            provenance,
            queries,
            space,
            captures,
        })
    }

    /// The space this snapshot's data belongs to, when it names one.
    pub fn space(&self) -> Option<&SpaceId> {
        self.space.as_ref()
    }

    /// The route's captures, when this data was built for one route.
    pub fn captures(&self) -> Option<&Arc<RouteCaptures>> {
        self.captures.as_ref()
    }

    /// The query source a `Runtime` should install: the route's captures,
    /// bound by request, for [`OfflineData::from_route`]; the snapshot's
    /// name-keyed table otherwise.
    pub fn source(&self) -> Arc<dyn QuerySource> {
        match &self.captures {
            Some(captures) => Arc::new(RouteQuerySource::new(captures.clone())),
            None => Arc::new(self.query_source()),
        }
    }

    /// A `SnapshotQuerySource` over this bag — name-keyed, so a claim whose
    /// `name_hint` the table knows is answered at `open`.
    pub fn query_source(&self) -> SnapshotQuerySource {
        SnapshotQuerySource::new(self.bag.clone())
    }

    /// A `FakeExecutor` holding the snapshot's `queries` table. It answers
    /// only requests it has learned — `note` on a compiled request's key,
    /// or `teach` for a direct binding — and refuses the rest into
    /// `provenance.dropped`, beside writes, commits, flows and shape calls.
    /// The factory binds the executor to the space the snapshot names;
    /// a snapshot that names none yields an executor that refuses every
    /// model call until `for_space` binds one — another space must never
    /// receive this space's rows by accident.
    pub fn executor(&self) -> FakeExecutor {
        let mut executor = FakeExecutor::new().with_queries(self.queries.clone());
        if let Some(captures) = &self.captures {
            executor = executor.with_captures(captures.clone());
        }
        let executor = executor
            .with_provenance(self.provenance.clone())
            .require_binding();
        match &self.space {
            Some(space) => executor.for_space(space.clone()),
            None => executor,
        }
    }

    /// Read `store.member` out of the bag as a plain value — for tests and
    /// the report example.
    pub fn member(&self, store: &str, member: &str) -> Value {
        let root = self.bag.root(store).unwrap_or(Value::Undefined);
        member_get(&root, member)
    }
}

/// What a snapshot may claim before [`StoreBag::from_snapshot`] looks at it:
/// `meta.format`, when present, must be `we-snapshot@2` (the C2a recorder's
/// gate), whose `routes` must then be well-formed route captures; a top-level
/// `version` (the older fixtures' gate) absent or `0`/`1`
/// is the format this reader knows — anything else
/// refuses rather than half-loading fields it cannot interpret. The known
/// tables, when present, must be objects; unknown fields pass through — a
/// recorder is free to decorate the file (`recordedAt`, `routes`, …).
fn validate_snapshot(json: &serde_json::Value) -> Result<(), String> {
    const SUPPORTED: u64 = 1;
    if let Some(version) = json.get("version") {
        let v = version
            .as_u64()
            .ok_or_else(|| format!("snapshot: version must be a whole number, got {version}"))?;
        if v > SUPPORTED {
            return Err(format!(
                "snapshot: unsupported version {v} (reader knows {SUPPORTED})"
            ));
        }
    }
    if crate::route::format(json)?.is_some() {
        crate::route::validate_routes(json)?;
    }
    for table in ["stores", "queries", "invokes"] {
        if let Some(v) = json.get(table) {
            if !v.is_object() {
                return Err(format!("snapshot: {table} must be an object"));
            }
        }
    }
    Ok(())
}

/// The space a snapshot speaks for: `meta.dataset` when the document
/// declares it (the recorded snapshot's space), else the
/// `spaceStore.spacePath` member's `/space/<id>` suffix — the claim an
/// older fixture makes. A snapshot that names neither speaks for no
/// space.
fn snapshot_space(json: &serde_json::Value) -> Option<SpaceId> {
    if let Some(dataset) = json
        .get("meta")
        .and_then(|m| m.get("dataset"))
        .and_then(|d| d.as_str())
    {
        return Some(SpaceId::new(dataset));
    }
    json.get("stores")
        .and_then(|s| s.get("spaceStore"))
        .and_then(|s| s.get("spacePath"))
        .and_then(|p| p.as_str())
        .and_then(|p| p.strip_prefix("/space/"))
        .map(SpaceId::new)
}

/// `routes.<id>.agents` — the `$agent` profiles the route bound — joined into
/// `profileStore.profiles`, which is where the Rust `$agent` looks: a did
/// the members' list already carries keeps its member row.
fn join_agents(
    stores: &mut serde_json::Map<String, serde_json::Value>,
    agents: Option<&serde_json::Value>,
) {
    let Some(agents) = agents.and_then(|a| a.as_object()) else {
        return;
    };
    if agents.is_empty() {
        return;
    }
    let profile_store = stores
        .entry("profileStore")
        .or_insert_with(|| serde_json::json!({}));
    let Some(profile_store) = profile_store.as_object_mut() else {
        return;
    };
    let profiles = profile_store
        .entry("profiles")
        .or_insert_with(|| serde_json::json!([]));
    let Some(list) = profiles.as_array_mut() else {
        return;
    };
    for (did, profile) in agents {
        let known = list
            .iter()
            .any(|p| p.get("did").and_then(|d| d.as_str()) == Some(did));
        if !known {
            list.push(profile.clone());
        }
    }
}

/// The snapshot's `queries` table, decoded — `IndexMap` keeps authored order.
fn query_table(json: &serde_json::Value) -> IndexMap<String, Value> {
    json.get("queries")
        .and_then(|q| q.as_object())
        .map(|table| {
            table
                .iter()
                .map(|(name, rows)| (name.clone(), Value::from_json(rows)))
                .collect()
        })
        .unwrap_or_default()
}

/// Overlay the store map's implemented members onto their stores.
fn apply_store_map(
    bag: &Arc<StoreBag>,
    map: &StoreMap,
    provenance: &Provenance,
) -> Result<(), String> {
    let mut overlays: IndexMap<String, IndexMap<Arc<str>, MemberImpl>> = IndexMap::new();
    for (path, row) in &map.members {
        let (store, member) = split_member(path);
        let member_impl = match row.kind {
            // Only `derived`/`modelRead` rows carry offline implementations —
            // `native` names a built-in, `expr` an expression over the bag.
            MemberKind::Derived | MemberKind::ModelRead => {
                if let Some(name) = row.native() {
                    MemberImpl::Native(named_native(name).ok_or_else(|| {
                        format!("store map: member {path}: unknown native {name}")
                    })?)
                } else if let Some(source) = row.expr() {
                    let expr = we_expr::parse(source).map_err(|e| {
                        format!("store map: member {path}: bad expr: {}", e.message)
                    })?;
                    MemberImpl::Expr(Arc::new(expr))
                } else {
                    continue;
                }
            }
            // screen/modelWrite/flow/command/widgetInternal/deferred: the
            // screen or the snapshot answers them; nothing to overlay.
            _ => continue,
        };
        overlays
            .entry(store.to_string())
            .or_default()
            .insert(member.into(), member_impl);
    }
    for (store, owned) in overlays {
        let base = bag.root(&store).unwrap_or(Value::Undefined);
        bag.set_root(
            &store,
            OverlayNs::wrap(&store, owned, base, bag, provenance),
        );
    }
    Ok(())
}
