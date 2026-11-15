//! `we-legacy` — the legacy screen-store adapter (E3c-6).
//!
//! Old templates read the screen through the store names WE gave them:
//! `routeStore`, `shellStore`, `themeStore` and `spaceStore.spacePath`.
//! Core binds only `screen` — the live [`ScreenView`]. This adapter binds
//! each legacy name once, as a face over the bag's root slot, and serves
//! every member read from the live state at read time:
//!
//! - a screen member (`routeStore.params.x`, `spaceStore.spacePath`,
//!   `shellStore.panels.inspector`, `themeStore.themeFork`) reads the
//!   view's current snapshot — a screen change is the very next answer;
//! - a data member (`spaceStore.members`, `themeStore.builtInThemes`)
//!   reads the bag's root *base* — whatever `set_root` last wrote.
//!
//! Nothing is captured at install: there is no base to go stale, so the
//! runtime-rebind residual the design's §5.1 calls out cannot come back —
//! `set_root("spaceStore", …)` then a screen change then a read answers
//! the new base and the new screen fact together.
mod surface;

pub use surface::LEGACY_MEMBER_TIERS;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, Weak};

use we_expr::{MountCx, Namespace, Tier, Value};
use we_template::{Bound, MemberRule, MemberTiers, RootLayer, ScreenView, StoreBag};

/// `member` → canonical allocation, for the members a face synthesizes —
/// moved from `StoreBag` (E3c-6): a face's overlay answers rebuild as
/// fresh maps and callables every snapshot, but while their content holds
/// the SAME value must answer, or a tracked initial's dep would move on an
/// unrelated screen change (R6-1).
#[derive(Debug, Clone, Default)]
struct Canon {
    map: Arc<Mutex<HashMap<Arc<str>, Value>>>,
}

impl Canon {
    /// `candidate`, interned: while the content holds, the canonical
    /// allocation answers; a changed answer replaces it.
    fn get(&self, member: &str, candidate: Value) -> Value {
        let key: Arc<str> = member.into();
        let Ok(mut map) = self.map.lock() else {
            return candidate;
        };
        match map.get(&key) {
            Some(held) if we_template::content_eq(held, &candidate) => held.clone(),
            _ => {
                map.insert(key, candidate.clone());
                candidate
            }
        }
    }
}

/// One key off a `Value` that may be a namespace.
fn read_key(value: &Value, key: &str) -> Value {
    match value {
        Value::Namespace(ns) => ns.get(key),
        _ => Value::Undefined,
    }
}

/// `routeStore`/`shellStore`/`themeStore` — the screen's member answers on
/// top, the store's own members underneath. The overlay is the view's
/// `nav`/`shell`/`theme` member read at call time; the base is the bag's
/// live root for the same name — `set_root` swaps it and the face answers
/// the new base on its very next read.
#[derive(Debug)]
struct MergedNs {
    /// `Weak`: the mount's `RootLayer` holds this face — a strong
    /// backref would cycle (`StoreBag → layer → face → bag`) and leak
    /// the whole bag, once per dropped session. Upgraded on read; a
    /// face whose bag is gone answers `Undefined` from the base side.
    bag: Weak<StoreBag>,
    /// The bag root this face sits over (`routeStore`, …).
    name: &'static str,
    /// The [`ScreenView`] member this face overlays (`nav`/`shell`/`theme`).
    member: &'static str,
    /// Reads the overlay owns even when its answer is `Undefined`/`null`.
    owned: &'static [&'static str],
    view: ScreenView,
    /// Canonical allocations for the overlay's answers — synthesized
    /// screen members only; forwarded data reads stay live.
    canon: Canon,
}

impl Namespace for MergedNs {
    fn get(&self, key: &str) -> Value {
        let over = read_key(&self.view.get(self.member), key);
        if self.owned.contains(&key) || !matches!(over, Value::Undefined) {
            return self.canon.get(key, over);
        }
        read_key(
            &self
                .bag
                .upgrade()
                .and_then(|bag| bag.root_base(self.name))
                .unwrap_or(Value::Undefined),
            key,
        )
    }

    fn keys(&self) -> Vec<Arc<str>> {
        let mut keys = match self.bag.upgrade().and_then(|bag| bag.root_base(self.name)) {
            Some(Value::Namespace(ns)) => ns.keys(),
            _ => Vec::new(),
        };
        if let Value::Namespace(ns) = self.view.get(self.member) {
            for k in ns.keys() {
                if !keys.iter().any(|e| e == &k) {
                    keys.push(k);
                }
            }
        }
        keys
    }
}

/// `spaceStore` merged with `spacePath` — the store's members underneath,
/// the screen's reading of where we are on top. `spacePath` is a screen
/// fact (`/space/<id>` inside a space, null out); a data root cannot
/// carry it because it changes with the route.
#[derive(Debug)]
struct SpaceStoreNs {
    /// `Weak` like [`MergedNs::bag`] — the face must never keep the bag
    /// its layer reads through alive.
    bag: Weak<StoreBag>,
    view: ScreenView,
    /// Canonical allocation for `spacePath` — the screen fact; every other
    /// member is the base store's data and reads live.
    canon: Canon,
}

impl SpaceStoreNs {
    /// The live `spacePath` — the view's `nav` member, read now.
    fn space_path(&self) -> Value {
        read_key(&self.view.get("nav"), "spacePath")
    }
}

impl Namespace for SpaceStoreNs {
    fn get(&self, key: &str) -> Value {
        if key == "spacePath" {
            return self.canon.get(key, self.space_path());
        }
        read_key(
            &self
                .bag
                .upgrade()
                .and_then(|bag| bag.root_base("spaceStore"))
                .unwrap_or(Value::Undefined),
            key,
        )
    }

    fn keys(&self) -> Vec<Arc<str>> {
        let mut keys = match self
            .bag
            .upgrade()
            .and_then(|bag| bag.root_base("spaceStore"))
        {
            Some(Value::Namespace(ns)) => ns.keys(),
            _ => Vec::new(),
        };
        if !keys.iter().any(|k| k.as_ref() == "spacePath") {
            keys.push("spacePath".into());
        }
        keys
    }
}

/// The profile a `$agent` binds, read the legacy way: `profileStore.
/// profiles` holds them — an object keyed by DID, or a list of rows
/// carrying `did`. `None` when no profile resolves (the resolver binds the
/// `{did}` stub). The one `profileStore` read in the renderer (Lal F1):
/// it lives in the legacy source, never in core.
pub fn profile_of(bag: &StoreBag, did: &str) -> Option<Value> {
    let profiles = match bag.root("profileStore") {
        Some(Value::Namespace(ns)) => ns.get("profiles"),
        _ => Value::Undefined,
    };
    match &profiles {
        Value::Obj(map) => map.get(did).cloned(),
        Value::List(rows) => rows
            .iter()
            .find(|row| {
                matches!(row, Value::Obj(o) if matches!(o.get("did"), Some(Value::Str(d)) if d.as_ref() == did))
            })
            .cloned(),
        _ => None,
    }
}

/// `sessionStore` readiness — `signInStep`/`bootState` reads `"ready"`;
/// an absent store answers ready (the bundle's own `$if` draws the boot in
/// WE). The one `sessionStore` read in the renderer (Lal F3): it lives in
/// the legacy source, never in core.
pub fn session_ready(bag: &StoreBag) -> bool {
    match bag.root("sessionStore") {
        Some(Value::Namespace(ns)) => {
            let step = ns.get("signInStep");
            let state = ns.get("bootState");
            matches!(&step, Value::Str(s) if s.as_ref() == "ready")
                || matches!(&state, Value::Str(s) if s.as_ref() == "ready")
        }
        _ => true,
    }
}

/// The installed adapter — the session's E3c-8a [`BindingSource`]: it
/// serves `screen` (the live view it already reads), the `legacy` root
/// (every old store name behind its generated member table), the compat
/// names themselves, the bag's plain data roots, `$agent`'s profile and
/// readiness. Its faces are also bound into the mount's own layer for
/// ungated plumbing reads — per session, never the bag's, so two
/// sessions on one bag keep their own.
#[derive(Debug)]
pub struct LegacyBindings {
    bag: Option<Arc<StoreBag>>,
    view: ScreenView,
    /// The faces `install` built, kept so `root(name)` can serve the same
    /// live allocation the layer holds.
    faces: HashMap<&'static str, Arc<dyn Namespace>>,
    /// `compat_roots()` — the generated table's names.
    compat: Arc<[Arc<str>]>,
}

/// The legacy screen-store names — the ones this adapter overlays with
/// live screen members (E3c-9 rewrites them to `screen.*`/`legacy.*`).
pub const LEGACY_STORES: [&str; 4] = ["routeStore", "shellStore", "themeStore", "spaceStore"];

/// The member table for a legacy store name — absent from the generated
/// table means the name is not a compat root at all.
///
/// Built once and shared: a table's identity is the policy identity the
/// gate keys its served wrapper by (Lal F7), so a fresh table per request
/// would rewrap — and cache — on every read.
fn member_tiers(name: &str) -> Option<MemberTiers> {
    static TABLES: OnceLock<HashMap<&'static str, MemberTiers>> = OnceLock::new();
    TABLES
        .get_or_init(|| {
            LEGACY_MEMBER_TIERS
                .iter()
                .map(|(name, rows)| (*name, store_tiers(name, rows)))
                .collect()
        })
        .get(name)
        .cloned()
}

/// The `screen` member a face overlays for `store` — `routeStore` reads
/// `nav`, `shellStore` `shell`, `themeStore` `theme`; `spaceStore`
/// overlays `nav.spacePath` alone. `None`: not a screen-backed store.
fn overlay_of(store: &str, member: &str) -> Option<&'static str> {
    match store {
        "routeStore" => Some("nav"),
        "shellStore" => Some("shell"),
        "themeStore" => Some("theme"),
        "spaceStore" if member == "spacePath" => Some("nav"),
        _ => None,
    }
}

/// One store's table: the generated `templateSurface.ts` rows — except
/// that every member a face answers from the screen is served through
/// CORE's screen table (Lal F2; decision: core's screen table is the
/// policy for every spelling). The stricter rule wins: a member either
/// table refuses is refused, and a member both allow is allowed only at
/// the higher of the two tiers. So `shellStore.activeShellView` (TS:
/// Space, core: App) reads Undefined at Space, while TS's denials
/// (`shellStore.panels`, absent from TS) stay denied.
fn store_tiers(store: &str, rows: &[(&'static str, Tier)]) -> MemberTiers {
    let screen = we_template::screen_tiers();
    let mut table: std::collections::BTreeMap<Arc<str>, MemberRule> =
        MemberTiers::from_rows(rows).members.as_ref().clone();
    for (member, rule) in table.iter_mut() {
        let Some(overlay) = overlay_of(store, member) else {
            continue;
        };
        let core = match screen.rule(overlay) {
            Some(MemberRule::Container { members, .. }) => members.rule(member).cloned(),
            _ => None,
        };
        let MemberRule::Member { tier: legacy } = *rule else {
            continue;
        };
        *rule = match core {
            // Not a screen fact core knows: the face's answer for it is
            // the store's own data — the TS row stands.
            None => continue,
            Some(MemberRule::Member { tier }) => MemberRule::Member {
                tier: tier.max(legacy),
            },
            Some(MemberRule::DeclaredIds { tier }) => MemberRule::DeclaredIds {
                tier: tier.max(legacy),
            },
            // A container under an overlay is not a member a face serves.
            Some(MemberRule::Container { .. }) => MemberRule::Member { tier: Tier::App },
        };
    }
    MemberTiers::new(table)
}

/// `legacy`'s own member table: every compat store name is a container
/// whose members are that store's generated table — `legacy.routeStore.
/// params` is `routeStore.params` filtered by `routeStore`'s rows.
fn legacy_tiers() -> MemberTiers {
    static TABLE: OnceLock<MemberTiers> = OnceLock::new();
    TABLE.get_or_init(build_legacy_tiers).clone()
}

fn build_legacy_tiers() -> MemberTiers {
    MemberTiers::new(
        LEGACY_MEMBER_TIERS
            .iter()
            .map(|(name, rows)| {
                (
                    Arc::from(*name),
                    MemberRule::Container {
                        tier: Tier::Space,
                        members: member_tiers(name).unwrap_or_else(|| store_tiers(name, rows)),
                    },
                )
            })
            .collect(),
    )
}

/// The `legacy` root: `legacy.<store>` answers the face when one exists,
/// the bag's live root otherwise — member filtering is the gate's job on
/// top of this namespace, so a raw value here is still filtered per
/// member below.
#[derive(Debug)]
struct LegacyRootNs {
    bag: Weak<StoreBag>,
    faces: HashMap<&'static str, Arc<dyn Namespace>>,
}

impl Namespace for LegacyRootNs {
    fn get(&self, key: &str) -> Value {
        if let Some(face) = self.faces.get(key) {
            return Value::Namespace(face.clone());
        }
        self.bag
            .upgrade()
            .and_then(|bag| bag.root(key))
            .unwrap_or(Value::Undefined)
    }

    fn keys(&self) -> Vec<Arc<str>> {
        LEGACY_MEMBER_TIERS
            .iter()
            .map(|(name, _)| Arc::from(*name))
            .collect()
    }
}

impl LegacyBindings {
    /// Bind the legacy screen stores into `layer` — the mount's own
    /// binding table over the shared bag — once: `routeStore` ← `nav`,
    /// `shellStore` ← `shell`, `themeStore` ← `theme`, and
    /// `spaceStore.spacePath` over the bag's `spaceStore` base. Every
    /// face reads live — rebind is never needed and stacking is
    /// impossible (each name holds exactly one face). The faces' bag
    /// backref is the layer's own `Weak` — installed, they read
    /// `root_base` for the data members.
    pub fn install(layer: &RootLayer, view: &ScreenView) -> Self {
        let bag = layer.bag().clone();
        let route = MergedNs {
            bag: bag.clone(),
            name: "routeStore",
            member: "nav",
            owned: &[
                "params",
                "templateSegments",
                "segments",
                "currentPath",
                "page",
                "href",
                "spacePath",
            ],
            view: view.clone(),
            canon: Canon::default(),
        };
        let shell = MergedNs {
            bag: bag.clone(),
            name: "shellStore",
            member: "shell",
            owned: &[
                "activeShellView",
                "spaceSettingsOpen",
                "spaceSettingsTab",
                "collapsedLanes",
                "layoutDirty",
                "panelsHidden",
                "panelMaximised",
                "createSpaceOpen",
                "joinSpaceOpen",
                "panels",
            ],
            view: view.clone(),
            canon: Canon::default(),
        };
        // `themeFork` is always the screen's call (`null` = no fork); an
        // unset `currentThemeId` reads Undefined and defers to the base.
        let theme = MergedNs {
            bag: bag.clone(),
            name: "themeStore",
            member: "theme",
            owned: &["themeFork"],
            view: view.clone(),
            canon: Canon::default(),
        };
        let route: Arc<dyn Namespace> = Arc::new(route);
        let shell: Arc<dyn Namespace> = Arc::new(shell);
        let theme: Arc<dyn Namespace> = Arc::new(theme);
        let space: Arc<dyn Namespace> = Arc::new(SpaceStoreNs {
            bag: bag.clone(),
            view: view.clone(),
            canon: Canon::default(),
        });
        layer.bind("routeStore", Value::Namespace(route.clone()));
        layer.bind("shellStore", Value::Namespace(shell.clone()));
        layer.bind("themeStore", Value::Namespace(theme.clone()));
        layer.bind("spaceStore", Value::Namespace(space.clone()));
        let faces = HashMap::from([
            ("routeStore", route),
            ("shellStore", shell),
            ("themeStore", theme),
            ("spaceStore", space),
        ]);
        Self {
            bag: bag.upgrade(),
            view: view.clone(),
            faces,
            compat: LEGACY_MEMBER_TIERS
                .iter()
                .map(|(name, _)| Arc::from(*name))
                .collect(),
        }
    }

    /// The bag the faces are bound over — `None` when it is gone.
    pub fn bag(&self) -> Option<&Arc<StoreBag>> {
        self.bag.as_ref()
    }

    /// The live view the faces read screen members through.
    pub fn view(&self) -> &ScreenView {
        &self.view
    }
}

impl LegacyBindings {
    /// The value a compat store name serves: its face (live screen
    /// overlay) when one exists, the bag's live root otherwise — the
    /// gate's member table applies on top either way.
    fn bound_value(&self, name: &str) -> Option<Value> {
        if let Some(face) = self.faces.get(name) {
            return Some(Value::Namespace(face.clone()));
        }
        self.bag.as_ref().and_then(|bag| bag.root(name))
    }
}

impl we_template::BindingSource for LegacyBindings {
    fn root(&self, name: &str, _mount: &MountCx) -> Option<Bound> {
        match name {
            // The live `screen` root — core classifies it `Screen` and
            // forces its own member table; this answers the value alone.
            "screen" => Some(Bound {
                value: Value::namespace(self.view.clone()),
                members: None,
                domain: None,
            }),
            // Every old store name under `legacy.*` — the containers'
            // member tables come from the generated oracle.
            "legacy" => Some(Bound {
                value: Value::namespace(LegacyRootNs {
                    bag: self.bag.as_ref().map(Arc::downgrade).unwrap_or_default(),
                    faces: self.faces.clone(),
                }),
                members: Some(legacy_tiers()),
                domain: None,
            }),
            _ => {
                if let Some(tiers) = member_tiers(name) {
                    // A compat store — served member-filtered until the
                    // bundle converts. `domain: None`: the classified
                    // Compat from `root_domain` applies; an unclassified
                    // name never reaches this branch.
                    return self.bag.as_ref().and_then(|_| {
                        self.bound_value(name).map(|value| Bound {
                            value,
                            members: Some(tiers),
                            domain: None,
                        })
                    });
                }
                // A plain data root — the host's own, traversable by
                // either tier.
                self.bag
                    .as_ref()
                    .and_then(|bag| bag.root(name))
                    .map(|value| Bound {
                        value,
                        members: None,
                        domain: Some(we_template::RootDomain::Space),
                    })
            }
        }
    }

    fn profile(&self, did: &str, _mount: &MountCx) -> Option<Value> {
        self.bag.as_ref().and_then(|bag| profile_of(bag, did))
    }

    fn ready(&self) -> bool {
        self.bag.as_ref().map(|b| session_ready(b)).unwrap_or(false)
    }

    fn compat_roots(&self) -> &[Arc<str>] {
        &self.compat
    }
}

impl we_template::DataRevision for LegacyBindings {
    /// The bag's own revision — the faces read it live, so a `set_root`
    /// or a screen change is visible in the next answer.
    fn revision(&self) -> u64 {
        self.bag.as_ref().map(|b| b.version()).unwrap_or(0)
    }

    /// The bag's subscription — the faces read live, so the bag's
    /// `set_root` invalidations are this source's whole change signal.
    /// `StoreBag::set_invalidator` dedups by inbox, so a re-install
    /// replaces rather than doubles.
    fn subscribe(&self, invalidator: we_template::Invalidator) {
        if let Some(bag) = self.bag.as_ref() {
            bag.set_invalidator(invalidator);
        }
    }
}
