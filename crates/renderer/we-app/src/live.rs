//! The Coasys app against a live executor (E7): the same app root
//! `coasys_app` renders from a recording, with the template's `$queries`
//! answered by [`we_ad4m::Ad4mQuerySource`] and the store map's live rows
//! served by [`we_ad4m::live::LiveMembers`].
//!
//! No recorded data inside a live space (Lal F4): every other member of the
//! recorded stores reads unavailable, except the few `data/connected.json`
//! allowlists — the bundle's themes and brand, and facts of connected mode
//! (booted, read-only). [`LiveSpace::provenance`] lists what was live, what
//! came from the bundle and what was unavailable. [`DataMode::DemoRecorded`]
//! (`--demo-recorded`) puts the whole recording back underneath, for demos
//! only.
//!
//! `$invoke` goes to a [`WriteHost`] (E11): the store map's write rows
//! (`record.*`, `recordStore.updateRecordField`,
//! `spaceStore.createSignalType`) write through the validated write RPC when
//! the window has [`Access::Write`], and are refused with a notice when it
//! is read-only; everything else is dropped and listed, as before. A write
//! reaches the screen through the live query that reads it, never
//! optimistically. Only a personal space may be opened for writing.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use we_ad4m::live::{LiveMap, LiveMembers};
use we_ad4m::write_host::ConfirmSlot;
use we_ad4m::{
    read_only_notice, Access, Ad4mQuerySource, Connection, Notice, Notices, SourceStats,
    SpaceBinding, SpaceRow, WriteHost,
};
use we_data::chat::{ChatAccess, ChatAuthority, ChatModel, ChatPort};
use we_data::writes::Confirm;
use we_data::{OfflineData, Provenance, SpaceId, StoreMap};
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{AppSpec, LocalState, NoParts, Runtime, SchemaNode, StaticHost};

use crate::{gallery, RendererApp};

const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");
const SEED_MAP: &str = include_str!("../../we-data/data/storemap-offline.json");
const CONNECTED: &str = include_str!("../data/connected.json");

/// What fills the members no live row answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DataMode {
    /// Nothing recorded: the allowlisted bundle members and the facts of
    /// connected mode, everything else unavailable. The default.
    #[default]
    Live,
    /// The whole recording underneath, recorded people and all — a demo
    /// mix, off unless asked for (`--demo-recorded`).
    DemoRecorded,
}

/// The recorded members a live space may read: the bundle's own.
pub fn bundle_allowlist() -> Vec<String> {
    let cfg: serde_json::Value = serde_json::from_str(CONNECTED).expect("connected.json parses");
    cfg["bundle"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m.as_str().map(str::to_string))
        .collect()
}

/// The members a live space answers with a fact of connected mode rather
/// than a recording (`data/connected.json`). Provenance counts them with the
/// bundle members, as "served by snapshot": both come from the bag's
/// document, and neither is recorded space data.
pub fn connected_facts() -> Vec<String> {
    let cfg: serde_json::Value = serde_json::from_str(CONNECTED).expect("connected.json parses");
    cfg["connected"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, _)| k.clone())
        .collect()
}

/// What a shared space opened with `--write` is refused with (brief §6 Q3).
pub const SHARED_WRITE_REFUSED: &str =
    "Writes to a shared space wait for the space's policy check, \
     which this app does not run yet. Open it without --write, or pick a personal space.";

/// The store document a live space's bag is built from: the allowlisted
/// bundle members copied out of the recording and the connected facts, no
/// queries, no canned `$invoke` replies. `admin` overrides
/// `spaceStore.canAdministerCurrentSpace`: a window with the write grant
/// administers the personal space it opened (TS `canAdministerSpace`
/// answers true for a personal space).
fn connected_doc(truth: &serde_json::Value, admin: bool) -> serde_json::Value {
    let cfg: serde_json::Value = serde_json::from_str(CONNECTED).expect("connected.json parses");
    let mut stores = serde_json::Map::new();
    let mut put = |path: &str, value: serde_json::Value| {
        let (store, member) = path.rsplit_once('.').unwrap_or((path, ""));
        stores
            .entry(store.to_string())
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .expect("a store is an object")
            .insert(member.to_string(), value);
    };
    for path in bundle_allowlist() {
        let (store, member) = path.rsplit_once('.').unwrap_or((&path, ""));
        if let Some(v) = truth["stores"][store].get(member) {
            put(&path, v.clone());
        }
    }
    if let Some(facts) = cfg["connected"].as_object() {
        for (path, v) in facts {
            put(path, v.clone());
        }
    }
    put("spaceStore.canAdministerCurrentSpace", admin.into());
    serde_json::json!({ "stores": stores, "queries": {}, "invokes": {} })
}

/// A recorded store with its recording left out: what it still holds
/// answers, and a read it cannot answer is noted unavailable.
#[derive(Debug)]
struct GapNs {
    store: Arc<str>,
    base: we_expr::Value,
    provenance: Provenance,
}

impl we_expr::Namespace for GapNs {
    fn get(&self, key: &str) -> we_expr::Value {
        let v = match &self.base {
            we_expr::Value::Namespace(ns) => ns.get(key),
            we_expr::Value::Obj(map) => map.get(key).cloned().unwrap_or(we_expr::Value::Undefined),
            _ => we_expr::Value::Undefined,
        };
        if v.is_undefined() {
            self.provenance
                .note_unavailable(format!("{}.{key}", self.store));
        }
        v
    }

    fn keys(&self) -> Vec<Arc<str>> {
        match &self.base {
            we_expr::Value::Namespace(ns) => ns.keys(),
            we_expr::Value::Obj(map) => map.keys().cloned().collect(),
            _ => vec![],
        }
    }
}

/// One open space: the app, and what the debug panel reads about it.
pub struct LiveSpace {
    pub app: RendererApp,
    pub space: SpaceRow,
    pub provenance: Provenance,
    pub source: Arc<SourceStats>,
    /// The members a live row answers.
    pub live_members: Vec<String>,
    /// What fills the members no live row answers.
    pub mode: DataMode,
    /// Whether this window may change the space.
    pub access: Access,
    notices: Notices,
    confirm: ConfirmSlot,
    /// The agent chat for this open space. The space screen binds it for
    /// one frame and clears the bind after. Offline frames stay unbound.
    pub chat: Arc<Mutex<ChatModel>>,
    /// The generation stamped into this space's chat permits. A new open
    /// space takes the next number, so a permit from the previous space
    /// does not match.
    pub chat_generation: u64,
    _live: LiveMembers,
}

fn next_chat_generation() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

impl LiveSpace {
    /// What went wrong with a write, newest last.
    pub fn notices(&self) -> Vec<Notice> {
        self.notices.list()
    }

    /// The notices, shared — the app draws and expires them.
    pub fn notice_list(&self) -> &Notices {
        &self.notices
    }

    /// The confirmation a destructive call waits on, if any.
    pub fn pending_confirm(&self) -> Option<Confirm> {
        self.confirm
            .lock()
            .ok()
            .and_then(|c| c.as_ref().map(|p| p.confirm.clone()))
    }

    /// The person answered the confirmation: `true` runs the write.
    pub fn answer_confirm(&mut self, yes: bool) {
        if let Some(host) = self.app.session.host_mut_as::<WriteHost>() {
            host.answer_confirm(yes);
        }
    }

    /// The status bar's word for what this window may do here: `read-only`
    /// or `writes: <space>`.
    pub fn access_label(&self) -> String {
        match self.access {
            Access::ReadOnly => "read-only".to_string(),
            Access::Write(_) => format!("writes: {}", self.space.name),
        }
    }

    /// Calls the host dropped (no write row), in order.
    pub fn dropped_calls(&self) -> Vec<String> {
        dropped_calls(&self.app.session)
    }
}

/// What a connected window's host dropped: the [`WriteHost`]'s fallback.
pub fn dropped_calls(session: &we_session::Session) -> Vec<String> {
    session
        .host_as::<WriteHost>()
        .map(|h| h.fallback.dropped.clone())
        .unwrap_or_default()
}

/// The route a space's index renders at — `/space/<uuid>`, the key every
/// `Here` query reads.
pub fn space_route(space: &SpaceRow) -> String {
    format!("/space/{}", space.uuid)
}

/// The bundle's app root over `space` on `conn`, painted with `theme_id`.
/// The second value says the theme was not recorded and `dark` stood in.
pub fn live_space_app(
    bundle: &we_template::Bundle,
    conn: &Connection,
    space: SpaceRow,
    theme_id: &str,
    mode: DataMode,
    access: Access,
) -> Result<(LiveSpace, bool), String> {
    if access.writes(&space.uuid) && space.shared_url.is_some() {
        return Err(SHARED_WRITE_REFUSED.into());
    }
    // The grant names one space: anywhere else this window is read-only,
    // and says so (the host refuses there too, whatever the connection).
    let here = access.in_space(&space.uuid);
    let truth: serde_json::Value =
        serde_json::from_str(SNAPSHOT).map_err(|e| format!("snapshot parse: {e}"))?;
    let live_map = LiveMap::bundled();
    let mut map = StoreMap::parse(SEED_MAP).map_err(|e| format!("seed map: {e}"))?;
    map.members.extend(live_map.derived.members.clone());
    // The live source answers every `$queries` entry; what fills the
    // members no live row answers depends on the mode.
    let data = match mode {
        DataMode::Live => {
            let data = OfflineData::from_snapshot(
                &connected_doc(&truth, here != Access::ReadOnly),
                Some(&map),
            )?;
            // Every recorded store answers what it still holds and notes
            // the rest unavailable.
            for store in truth["stores"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(k, _)| k)
            {
                let base = data.bag.root(store).unwrap_or(we_expr::Value::Undefined);
                data.bag.set_root(
                    store,
                    we_expr::Value::Namespace(Arc::new(GapNs {
                        store: store.as_str().into(),
                        base,
                        provenance: data.provenance.clone(),
                    })),
                );
            }
            data
        }
        DataMode::DemoRecorded => OfflineData::from_snapshot(&truth, Some(&map))?,
    };
    let mut binding = SpaceBinding::new(&space.uuid);
    if let Some(url) = &space.shared_url {
        binding = binding.also(url);
    }
    let live = LiveMembers::install(
        &data.bag,
        &data.provenance,
        &live_map,
        conn,
        &binding,
        space.shared_url.as_deref(),
    );
    let source = Arc::new(Ad4mQuerySource::new(conn.clone(), binding));
    let stats = source.stats();

    let spec = AppSpec {
        bundle: bundle.name.clone().into(),
        app: bundle.app.clone(),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let screen = ScreenState::desktop(
        ScreenSchema {
            pages: bundle
                .pages
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|p| p.id.clone())
                .collect(),
            ..ScreenSchema::default()
        },
        &space_route(&space),
    );
    let placeholder: SchemaNode =
        serde_json::from_value(serde_json::json!({ "type": "Column" })).unwrap();
    let registry = Registry::with_builtins();
    let types: std::collections::HashSet<&'static str> = registry.type_names().collect();
    let mut app = RendererApp::new(placeholder, "coasys", data.bag.clone(), screen, registry);
    // Open from a recording, but live the first screen is drawn first: what
    // the template holds for it (the sidebar's latest calls) starts after.
    data.bag
        .set_host_member("spaceStore", "firstScreenOpen", we_expr::Value::Bool(false));
    app.hold_first_screen(data.bag.clone());
    let runtime = Runtime::app(spec, data.bag.clone(), LocalState::new())
        .with_sources(Some(source), Arc::new(NoParts))
        .with_dollar_types(move |ty| types.contains(ty));
    app.session.set_runtime(runtime);
    let host = WriteHost::new(
        StaticHost::new(data.bag.clone()),
        conn.clone(),
        SpaceId::from(space.uuid.as_str()),
        data.bag.clone(),
        access.clone(),
    );
    let notices = host.notices();
    if here == Access::ReadOnly && access != Access::ReadOnly {
        notices.push(read_only_notice(&access, &space.uuid));
    }
    let confirm = host.confirm_handle();
    app.session.host = Box::new(host);
    app.dropped_calls = dropped_calls;
    let set = gallery::load_theme_set();
    let (theme, fell_back) = set.theme(theme_id);
    app.theme = theme.clone();
    let port: Box<dyn ChatPort + Send> = Box::new(we_ad4m::AiSessionChat::new(conn));
    let chat_access = if here.writes(&space.uuid) {
        ChatAccess::Write
    } else {
        ChatAccess::ReadOnly
    };
    let authority = ChatAuthority::space(space.uuid.clone(), Some(space.name.clone()), chat_access);
    let chat = Arc::new(Mutex::new(ChatModel::bound(port, authority)));
    Ok((
        LiveSpace {
            app,
            space,
            provenance: data.provenance.clone(),
            source: stats,
            live_members: live.members().to_vec(),
            mode,
            access: here,
            notices,
            confirm,
            chat,
            chat_generation: next_chat_generation(),
            _live: live,
        },
        fell_back,
    ))
}
