//! `Gate` — the one deny-by-default check for every capability the
//! renderer answers (design 4.6). Core never decides; it asks. This file
//! holds the E3c-8a read half — `root` / `member` / `screen_read` /
//! `dataset` — plus the nested-authority frame stack (4.6.3) and the
//! member-filtering namespaces the bounds wear. `screen_verb` and the
//! general `action` check land with E3c-8b. Base-store invokes are
//! issued here ([`Gate::issue_base_permit`]): a permit, or no call.
//!
//! Two rules keep it honest:
//!
//! - **Fail closed.** Anything the gate cannot classify is refused — an
//!   unknown root, an unlisted member, an unclassifiable dataset — never
//!   served. A refusal is `Undefined`/absent to the template, plus one
//!   diagnostic per (mount, name) so a probing template has no error
//!   channel to read.
//! - **Stamped authority.** The `auth` a check sees is the frame's
//!   `MountCx` — what the runtime stamped at mount time — so nothing a
//!   template authors (`meta.role`, a handle in data, a caller's scope)
//!   mints authority it was not given.
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use we_expr::{BundleSlot, MapNamespace, MountCx, MountId, Namespace, Provenance, Tier, Value};

use crate::bindings::{Bound, MemberRule, MemberTiers, RootDomain};
use crate::query::DatasetSel;

/// Proof the gate allowed a read — only `Gate` methods mint one, so a
/// callsite cannot mark its own request allowed (Lal: permit issuance and
/// execution stay together).
#[derive(Debug, Clone, Copy)]
pub struct Permit(());

/// What the host told the gate about the built-in base screen.
///
/// The gate copies this at the start of a dispatch. It does not read the
/// live controller. A later call in the same dispatch still sees this copy.
#[derive(Clone, Debug)]
pub struct BasePermitFacts {
    /// The built-in bundle id the host mounted. Provenance must name it.
    pub builtin: Arc<str>,
    /// The controller's generation at the start of this dispatch.
    pub generation: u64,
    /// Connection ids `baseStore.choose` may name.
    pub catalog: Vec<Arc<str>>,
    /// A connect attempt is in flight. Only `closePage` and
    /// `clearPasswordWrong` are issued while this is set.
    pub busy: bool,
}

/// Proof the gate allowed one base-store call. No public constructor:
/// only [`Gate::issue_base_permit`] mints one.
#[derive(Clone, Debug)]
pub struct ActionPermit {
    target: Arc<str>,
    args_json: String,
    generation: u64,
    mount: MountId,
}

impl ActionPermit {
    pub fn target(&self) -> &str {
        &self.target
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn mount(&self) -> &MountId {
        &self.mount
    }

    /// The call the host received is the call the gate allowed.
    pub fn matches(&self, target: &str, args: &[Value]) -> bool {
        self.target.as_ref() == target && self.args_json == args_json(args)
    }
}

fn args_json(args: &[Value]) -> String {
    let list: Vec<_> = args.iter().map(Value::to_json).collect();
    serde_json::to_string(&list).unwrap_or_else(|_| "[]".to_string())
}

/// The gate's answer.
#[derive(Debug)]
pub enum Verdict {
    /// Allowed — the permit is evidence, not a public claim.
    Allow(Permit),
    /// Refused — absent to the template; the denial is counted once.
    Deny,
}

impl Verdict {
    pub fn allowed(&self) -> bool {
        matches!(self, Verdict::Allow(_))
    }
}

/// The panels/dialogs a mount's template declared in `meta` — the ids
/// `screen.panels`/`screen.dialogs` (and the legacy `openTemplatePanel`)
/// may name for that mount. Stamped at mount construction like the tier;
/// a mount that declared nothing reads an empty map.
#[derive(Debug, Clone, Default)]
pub struct Declared {
    /// `meta.panels` ids.
    pub panels: Arc<[Arc<str>]>,
    /// `meta.dialogs` ids.
    pub dialogs: Arc<[Arc<str>]>,
    /// The lanes the template owns: every `meta.panels[].home` (Lal N2 —
    /// "undeclared lanes are App").
    pub lanes: Arc<[Arc<str>]>,
}

impl Declared {
    /// The declared set from a template's `meta` — `meta.panels` carries
    /// `{id, home, open, node}` objects, `meta.dialogs` either an id list
    /// or an id-keyed map. Anything else declares nothing.
    pub fn from_meta(meta: &serde_json::Value) -> Declared {
        let ids = |key: &str| -> Arc<[Arc<str>]> {
            match meta.get(key) {
                Some(serde_json::Value::Array(items)) => items
                    .iter()
                    .filter_map(|item| {
                        item.as_str()
                            .map(str::to_string)
                            .or_else(|| item.get("id")?.as_str().map(str::to_string))
                    })
                    .map(Into::into)
                    .collect(),
                Some(serde_json::Value::Object(map)) => {
                    map.keys().map(|k| k.as_str().into()).collect()
                }
                _ => Arc::from([]),
            }
        };
        let mut lanes: Vec<Arc<str>> = Vec::new();
        if let Some(serde_json::Value::Array(items)) = meta.get("panels") {
            for home in items.iter().filter_map(|i| i.get("home")?.as_str()) {
                if !lanes.iter().any(|l| l.as_ref() == home) {
                    lanes.push(home.into());
                }
            }
        }
        Declared {
            panels: ids("panels"),
            dialogs: ids("dialogs"),
            lanes: lanes.into(),
        }
    }
}

/// One nested-authority frame (design 4.6.3): the evaluation context a
/// mount, part, panel, record view or slot body runs under. What a frame
/// changes is *authority*: the resolve inside it evaluates with `auth` as
/// the asking `MountCx` and `declared` as its panels/dialogs — and because
/// the resolver rebuilds scope and declarations per frame, a child mount
/// inherits neither the parent's locals nor its app-tier reach.
///
/// The same struct is what a resolved handler remembers (`HandlerRef::
/// frame`): dispatch and completions re-enter under it, never under
/// whatever the frontend or completer says.
#[derive(Debug, Clone)]
pub struct Frame {
    /// The authority — tier, mount id, space, provenance — every gate
    /// check in this frame answers against.
    pub auth: MountCx,
    /// The panels/dialogs `auth`'s template declared.
    pub declared: Declared,
}

/// What a denial was for — one line in the diagnostic set.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Denial {
    /// The mount that asked.
    mount: Arc<str>,
    /// What it asked for (`root:<name>`, `member:<name>`,
    /// `dataset:<key>`).
    what: Arc<str>,
}

/// The boundary itself. `handles` resolves dataset handles; `denials` is
/// the deduped diagnostic log — a `Mutex` because the same `Gate` serves
/// every frame in the runtime. `served` memoizes the filtered wrapper per
/// (root, authority, inner allocation): the `screen` root a resolve reads
/// a dozen times must answer ONE namespace identity or every tracked dep
/// on it moves each pass — while a rebound inner Arc (a store write)
/// re-wraps so the fresh binding is what gets filtered.
#[derive(Debug)]
pub struct Gate {
    handles: we_expr::HandleTable,
    denials: Mutex<BTreeSet<Denial>>,
    served: Mutex<HashMap<ServeKey, Value>>,
}

/// The most served wrappers a gate caches (F8). A session reads a few
/// dozen roots per mount; the cap only matters to a pathological source
/// that answers a fresh allocation per read.
pub const SERVED_CAP: usize = 1024;

/// The most distinct refusals a gate logs (F8).
pub const DENIALS_CAP: usize = 4096;

/// What a served wrapper is keyed by — the root name, the asking mount,
/// and the inner namespace's identity.
#[derive(Debug, PartialEq, Eq, Hash)]
struct ServeKey {
    name: Arc<str>,
    mount: Arc<str>,
    tier: Tier,
    panels: Arc<[Arc<str>]>,
    dialogs: Arc<[Arc<str>]>,
    lanes: Arc<[Arc<str>]>,
    inner: usize,
    /// The member table's identity (F7) — a tightened policy on the same
    /// inner Arc is a different key. Held alive by the cached wrapper.
    policy: usize,
}

impl Gate {
    pub fn new(handles: we_expr::HandleTable) -> Gate {
        Gate {
            handles,
            denials: Mutex::new(BTreeSet::new()),
            served: Mutex::new(HashMap::new()),
        }
    }

    fn denials(&self) -> MutexGuard<'_, BTreeSet<Denial>> {
        self.denials.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Record the refusal once per (mount, what) — the diagnostic a probe
    /// cannot turn into a value channel.
    fn deny(&self, auth: &MountCx, what: String) -> Verdict {
        let mut denials = self.denials();
        // Bounded (Lal F8): a probe minting names (or `$each` part sites
        // minting mounts) cannot grow the log without limit; past the cap
        // a refusal still refuses, it is just not logged again.
        if denials.len() < DENIALS_CAP {
            denials.insert(Denial {
                mount: auth.mount.as_str().into(),
                what: what.into(),
            });
        }
        Verdict::Deny
    }

    fn allow(&self) -> Verdict {
        Verdict::Allow(Permit(()))
    }

    /// How many served wrappers the gate holds — tests and the
    /// diagnostics surface read this (Lal F8: it must not grow per read).
    pub fn served_len(&self) -> usize {
        self.served.lock().unwrap_or_else(|p| p.into_inner()).len()
    }

    /// How many distinct refusals were logged — tests and the diagnostics
    /// surface read this.
    pub fn denial_count(&self) -> usize {
        self.denials().len()
    }

    // ── reads ───────────────────────────────────────────────────────

    /// `Gate::root` — may `auth` traverse a root in `domain`? The caller
    /// has already classified `name` (core's [`crate::bindings::root_domain`]
    /// wins; a source's own `Bound::domain` declares what the table does
    /// not know). Only the app domain is tier-fenced — Space, Screen and
    /// Compat traverse at both tiers and do their fencing per member.
    pub fn root(&self, auth: &MountCx, name: &str, domain: RootDomain) -> Verdict {
        match domain {
            RootDomain::App if auth.tier < Tier::App => self.deny(auth, format!("root:{name}")),
            _ => self.allow(),
        }
    }

    /// The one unknown-root verdict — a name core's table and the
    /// source's own declaration both missed.
    pub fn root_unknown(&self, auth: &MountCx, name: &str) -> Verdict {
        self.deny(auth, format!("root:{name}"))
    }

    /// Serve `bound` under `domain` — the member filtering the gate
    /// applies on top of [`Self::root`]:
    ///
    /// - `screen` wears core's table always — the source supplies the
    ///   value, never the policy.
    /// - `legacy` (and every compat-domain bound) MUST carry a member
    ///   table: the member tier decision is core's to apply, so a bound
    ///   that asks to be served without one is refused as a whole — one
    ///   diagnostic, `Undefined` to the template (design F1, F3).
    /// - anything else rides its domain alone (`members` on a plain
    ///   root is the source's own narrower filter — still applied).
    ///
    /// `None` = the read is absent.
    pub fn serve(
        self: &Arc<Self>,
        name: &str,
        domain: RootDomain,
        bound: Bound,
        auth: &MountCx,
        declared: &Declared,
    ) -> Option<Value> {
        let Bound {
            value,
            members,
            domain: _,
        } = bound;
        let members = if matches!(domain, RootDomain::Screen) {
            Some(screen_tiers())
        } else {
            members
        };
        let Some(tiers) = members else {
            if matches!(domain, RootDomain::Compat) {
                self.deny(auth, format!("root:{name}"));
                return None;
            }
            return Some(value);
        };
        match value {
            Value::Namespace(inner) => {
                let key = ServeKey {
                    name: name.into(),
                    mount: auth.mount.as_str().into(),
                    tier: auth.tier,
                    panels: declared.panels.clone(),
                    dialogs: declared.dialogs.clone(),
                    lanes: declared.lanes.clone(),
                    inner: Arc::as_ptr(&inner) as *const () as usize,
                    policy: tiers.id(),
                };
                let mut served = self.served.lock().unwrap_or_else(|p| p.into_inner());
                if served.len() >= SERVED_CAP && !served.contains_key(&key) {
                    // Bounded (Lal F8): first drop the wrappers nobody but
                    // the cache still holds; if every one is live, start
                    // over — a fresh wrapper costs identity, never safety.
                    served.retain(|_, v| match v {
                        Value::Namespace(ns) => Arc::strong_count(ns) > 1,
                        _ => false,
                    });
                    if served.len() >= SERVED_CAP {
                        served.clear();
                    }
                }
                Some(
                    served
                        .entry(key)
                        .or_insert_with(|| {
                            Value::namespace(FilteredNs {
                                inner,
                                tiers,
                                auth: auth.clone(),
                                declared: declared.clone(),
                                gate: Arc::downgrade(self),
                                memo: Mutex::new(HashMap::new()),
                            })
                        })
                        .clone(),
                )
            }
            _ => {
                self.deny(auth, format!("root:{name}"));
                None
            }
        }
    }

    /// `Gate::member` — one access on a bound's member table. `rule` is
    /// what the bound's [`MemberTiers`] says about `member` (`None` =
    /// unlisted = denied); `declared` is the mount's own panels/dialogs
    /// for the `DeclaredIds` case.
    pub fn member(
        &self,
        auth: &MountCx,
        member: &str,
        rule: Option<&MemberRule>,
        declared: &Declared,
    ) -> MemberVerdict {
        match rule {
            None => {
                self.deny(auth, format!("member:{member}"));
                MemberVerdict::Deny
            }
            Some(MemberRule::Member { tier }) if auth.tier >= *tier => MemberVerdict::Plain,
            Some(MemberRule::Container { tier, members }) if auth.tier >= *tier => {
                MemberVerdict::Container(members.clone())
            }
            Some(MemberRule::DeclaredIds { tier }) if auth.tier >= *tier => {
                MemberVerdict::Ids(declared_for(declared, member))
            }
            Some(MemberRule::DeclaredLanes { tier }) if auth.tier >= *tier => {
                MemberVerdict::Lanes(visible_lanes(auth, declared))
            }
            Some(_) => {
                self.deny(auth, format!("member:{member}"));
                MemberVerdict::Deny
            }
        }
    }

    /// `Gate::screen_read` — a read of `ScreenState` outside the `screen`
    /// namespace (the resolver's own `shell.panels`/`shell.lanes`
    /// lookups). The same member table the `screen` root's filtered
    /// namespace applies: [`MemberVerdict::Ids`] hands back the frame's
    /// declared set for a `DeclaredIds` member.
    pub fn screen_read(&self, auth: &MountCx, member: &str, declared: &Declared) -> MemberVerdict {
        self.member(auth, member, screen_tiers().rule(member), declared)
    }

    /// `Gate::dataset` — may `auth`'s claim run against `sel`? A space
    /// authority may ask only `Here` — the mount's own space; `Named` is
    /// app-domain selection (design 4.6.1). A foreign or tainted handle is
    /// refused too — it can never name this table's space.
    pub fn dataset(&self, auth: &MountCx, sel: &DatasetSel) -> Verdict {
        match sel {
            DatasetSel::Here => self.allow(),
            DatasetSel::Named(h) => {
                if auth.tier >= Tier::App && self.handles.key(h.handle()).is_some() {
                    self.allow()
                } else {
                    self.deny(auth, "dataset:named".into())
                }
            }
        }
    }

    /// Issue a permit for one `baseStore.*` call, or `None`.
    ///
    /// `facts == None` means this session has no base screen: the call
    /// gets no permit and no denial, so every other app is unchanged.
    /// When facts are installed, a call that is not the built-in base
    /// mount, not an allowed target, or not the allowed arguments is
    /// refused and counted. `meta.role` is not an input.
    pub fn issue_base_permit(
        &self,
        auth: &MountCx,
        target: &str,
        args: &[Value],
        facts: Option<&BasePermitFacts>,
    ) -> Option<ActionPermit> {
        let method = target.strip_prefix("baseStore.")?;
        let facts = facts?;
        if !trusted_base_mount(auth, &facts.builtin) {
            self.deny(auth, format!("action:{target}"));
            return None;
        }
        if !base_args_ok(method, args, &facts.catalog) {
            self.deny(auth, format!("action:{target}"));
            return None;
        }
        let exempt = matches!(method, "closePage" | "clearPasswordWrong");
        if facts.busy && !exempt {
            self.deny(auth, format!("action:{target}"));
            return None;
        }
        Some(ActionPermit {
            target: target.into(),
            args_json: args_json(args),
            generation: facts.generation,
            mount: auth.mount.clone(),
        })
    }
}

/// The built-in base slot at App or above. The bundle id is the one the
/// host mounted. A role string cannot satisfy this.
fn trusted_base_mount(auth: &MountCx, builtin: &str) -> bool {
    auth.tier >= Tier::App
        && matches!(
            &auth.provenance,
            Provenance::Bundle { bundle, slot: BundleSlot::Base } if bundle.as_ref() == builtin
        )
}

/// The targets the connect screen calls, with the argument list each one
/// takes. Anything else is refused.
fn base_args_ok(method: &str, args: &[Value], catalog: &[Arc<str>]) -> bool {
    match method {
        "openPage" => matches!(
            args,
            [Value::Str(page)] if page.as_ref() == "devices" || page.as_ref() == "security"
        ),
        "choose" => matches!(
            args,
            [Value::Str(id)] if catalog.iter().any(|row| row.as_ref() == id.as_ref())
        ),
        "closePage" | "makeIdentity" | "linkIdentity" | "useWords" | "startNow" | "retry"
        | "showConnections" | "clearPasswordWrong" | "submitPassword" => args.is_empty(),
        _ => false,
    }
}

/// Which declared-id set a `DeclaredIds` member filters by — `panels`
/// reads the template's `meta.panels`, `dialogs` its `meta.dialogs`;
/// anything else declared-id shaped is denied by construction.
fn declared_for(declared: &Declared, member: &str) -> Arc<[Arc<str>]> {
    match member {
        "panels" => declared.panels.clone(),
        "dialogs" => declared.dialogs.clone(),
        _ => Arc::from([]),
    }
}

/// The lanes whose names and collapse state `auth` may see (Lal N2), or
/// `None` for every lane. THE lane policy — every spelling of
/// `collapsedLanes` (core `screen.shell.*`, the legacy `shellStore.*` and
/// `legacy.shellStore.*` aliases) and the resolver's own `$panels`
/// collapse check come through here. Today: the design rule "undeclared
/// lanes are App" — App sees every lane, a lower frame only the lanes its
/// template declared. Making lane names public would be `None` here.
pub fn visible_lanes(auth: &MountCx, declared: &Declared) -> Option<Arc<[Arc<str>]>> {
    if auth.tier >= Tier::App {
        None
    } else {
        Some(declared.lanes.clone())
    }
}

/// The gate's richer answer for a member access — what the filtering
/// namespace does next.
pub enum MemberVerdict {
    /// Refused.
    Deny,
    /// Serve the raw member value.
    Plain,
    /// Serve the member wrapped in this container's own filter.
    Container(MemberTiers),
    /// Serve the member filtered to these declared ids.
    Ids(Arc<[Arc<str>]>),
    /// Serve a list of lane names, kept to these lanes (`None`: every
    /// lane) — see [`visible_lanes`].
    Lanes(Option<Arc<[Arc<str>]>>),
}

// ── the screen member table ──────────────────────────────────────────

/// `screen`'s member table (design 4.2): the space tier sees the route,
/// the params, this template's own panels and dialogs, and the two layout
/// facts Coasys' space template reads (`layoutDirty`, and `collapsedLanes`
/// kept to the lanes it declared — [`visible_lanes`]);
/// overlays, dock, space settings and the theme fork are chrome's. The
/// ONE screen policy (E3c-8a r2, F2): `we-legacy` serves every old
/// spelling of a screen fact through this table. The same table is shared
/// across `screen.<member>`, `screen.nav|shell|theme.<member>` because
/// the view flattens the three bags onto the root — a member is either
/// reachable at a tier or it is not.
pub fn screen_tiers() -> MemberTiers {
    // Built once: the table's identity is the policy identity a served
    // wrapper is keyed by (F7), so every `screen` read must hand back the
    // same table or the root would rewrap on every read.
    static TABLE: std::sync::OnceLock<MemberTiers> = std::sync::OnceLock::new();
    TABLE.get_or_init(build_screen_tiers).clone()
}

fn build_screen_tiers() -> MemberTiers {
    let nav_member = |members: &mut BTreeMap<Arc<str>, MemberRule>, name: &str| {
        members.insert(Arc::from(name), MemberRule::Member { tier: Tier::Space });
    };
    let app_member = |members: &mut BTreeMap<Arc<str>, MemberRule>, name: &str| {
        members.insert(Arc::from(name), MemberRule::Member { tier: Tier::App });
    };

    // The nav family — the route and its params are space vocabulary.
    let mut nav = BTreeMap::new();
    for m in [
        "params",
        "templateSegments",
        "segments",
        "currentPath",
        "page",
        "href",
        "spacePath",
    ] {
        nav_member(&mut nav, m);
    }

    // `shell`: this template's panels/dialogs are space's; the overlays,
    // dock and space-settings panel are the app's furniture.
    let mut shell = BTreeMap::new();
    for m in ["panels", "dialogs"] {
        shell.insert(Arc::from(m), MemberRule::DeclaredIds { tier: Tier::Space });
    }
    // Space by TS (`templateSurface.ts` 1373/1379: `view-state`) AND read
    // at Space by a shipped template (Coasys `templates/0`: a panel body's
    // reset control, the lane toggles in its routes and record view) —
    // E3c-8a r2, F2. This table is the policy for every spelling: the
    // legacy aliases cannot grant more than it does.
    nav_member(&mut shell, "layoutDirty");
    // The list itself is filtered to the lanes the reading template
    // declared (Lal N2: "undeclared lanes are App") — `visible_lanes`.
    shell.insert(
        Arc::from("collapsedLanes"),
        MemberRule::DeclaredLanes { tier: Tier::Space },
    );
    for m in [
        "activeShellView",
        "spaceSettingsOpen",
        "spaceSettingsTab",
        "panelsHidden",
        "panelMaximised",
        "createSpaceOpen",
        "joinSpaceOpen",
    ] {
        app_member(&mut shell, m);
    }

    // `theme`: the theme in use is space vocabulary; the editing fork is
    // the chrome editor's.
    let mut theme = BTreeMap::new();
    nav_member(&mut theme, "currentThemeId");
    app_member(&mut theme, "themeFork");

    let mut members = BTreeMap::new();
    for (name, inner) in [("nav", nav), ("shell", shell), ("theme", theme)] {
        members.insert(
            Arc::from(name),
            MemberRule::Container {
                tier: Tier::Space,
                members: MemberTiers::new(inner.clone()),
            },
        );
        // The flattened spelling: `screen.params` reads `screen.nav.params`.
        for (m, rule) in inner {
            members.entry(Arc::from(m.as_ref())).or_insert(rule);
        }
    }
    MemberTiers::new(members)
}

// ── filtered namespaces ──────────────────────────────────────────────

/// A bound namespace seen through the gate: every `get` consults
/// [`Gate::member`] against the bound's table, so an unlisted or
/// under-tier member is `Undefined` and enumeration shows only what the
/// authority may have (Lal R3: enumeration and `raw` are filtered too).
#[derive(Debug)]
pub struct FilteredNs {
    inner: Arc<dyn Namespace>,
    tiers: MemberTiers,
    auth: MountCx,
    declared: Declared,
    /// `Weak` (Lal F8): the gate's cache holds this wrapper, so a strong
    /// back edge was a cycle that outlived the runtime. A wrapper whose
    /// gate is gone answers nothing — fail closed.
    gate: Weak<Gate>,
    /// Wrapped children by member name, with the inner child each wraps —
    /// `screen.nav` answers one identity per read while its inner child
    /// holds, and a fresh one when it is replaced (F7).
    memo: Mutex<HashMap<Arc<str>, (Value, Value)>>,
}

impl FilteredNs {
    /// The wrapper cached for `key` while its inner child is still `src`
    /// (same allocation — the entry holds `src`, so the address cannot be
    /// reused under it); a replaced child is rewrapped (Lal F7).
    fn memoized(&self, key: &str, src: Value, wrap: impl FnOnce() -> Value) -> Value {
        let mut memo = self.memo.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((held, wrapper)) = memo.get(key) {
            if same_alloc(held, &src) {
                return wrapper.clone();
            }
        }
        let wrapper = wrap();
        memo.insert(key.into(), (src, wrapper.clone()));
        wrapper
    }
}

/// Whether two values are the same allocation — the identity a memo
/// entry keys a wrapper by.
pub(crate) fn same_alloc(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Namespace(a), Value::Namespace(b)) => Arc::ptr_eq(a, b),
        (Value::Obj(a), Value::Obj(b)) => Arc::ptr_eq(a, b),
        _ => false,
    }
}

impl Namespace for FilteredNs {
    fn get(&self, key: &str) -> Value {
        let Some(gate) = self.gate.upgrade() else {
            return Value::Undefined;
        };
        match gate.member(&self.auth, key, self.tiers.rule(key), &self.declared) {
            MemberVerdict::Deny => Value::Undefined,
            MemberVerdict::Plain => self.inner.get(key),
            MemberVerdict::Container(tiers) => {
                let src = self.inner.get(key);
                let Value::Namespace(ns) = &src else {
                    return Value::Undefined;
                };
                let ns = ns.clone();
                self.memoized(key, src, || {
                    Value::namespace(FilteredNs {
                        inner: ns,
                        tiers,
                        auth: self.auth.clone(),
                        declared: self.declared.clone(),
                        gate: Arc::downgrade(&gate),
                        memo: Mutex::new(HashMap::new()),
                    })
                })
            }
            // An id map in any shape the gate can filter (Lal F6): a
            // namespace, or a plain object read as one; anything else — a
            // list, a scalar — has no ids to filter by and is refused.
            MemberVerdict::Ids(ids) => {
                let src = self.inner.get(key);
                let ns: Arc<dyn Namespace> = match &src {
                    Value::Namespace(ns) => ns.clone(),
                    Value::Obj(map) => Arc::new(MapNamespace::new((**map).clone())),
                    _ => return Value::Undefined,
                };
                self.memoized(key, src, || Value::namespace(DeclaredNs { inner: ns, ids }))
            }
            MemberVerdict::Lanes(None) => self.inner.get(key),
            // A lane list kept to the visible lanes; any other shape has
            // no lane names to keep and is refused.
            MemberVerdict::Lanes(Some(lanes)) => match self.inner.get(key) {
                Value::List(items) => Value::List(Arc::new(
                    items
                        .iter()
                        .filter(|i| {
                            matches!(i, Value::Str(s) if lanes.iter().any(|l| l.as_ref() == s.as_ref()))
                        })
                        .cloned()
                        .collect(),
                )),
                _ => Value::Undefined,
            },
        }
    }

    /// Only members the authority may read — a denied member must not be
    /// enumerable any more than it is readable.
    fn keys(&self) -> Vec<Arc<str>> {
        self.tiers
            .members
            .iter()
            .filter(|(_, rule)| match rule {
                MemberRule::Member { tier }
                | MemberRule::Container { tier, .. }
                | MemberRule::DeclaredIds { tier }
                | MemberRule::DeclaredLanes { tier } => self.auth.tier >= *tier,
            })
            .map(|(name, _)| name.clone())
            .collect()
    }

    /// `raw`/`to_json` enumerate `keys`, so the filtered view is what
    /// settling and canon see — the inner namespace is never exposed.
    fn raw(&self) -> Option<Value> {
        None
    }
}

/// An id→value map restricted to the mount's declared ids — the
/// `screen.panels`/`screen.dialogs` shape: an undeclared id is `Undefined`
/// and `keys` shows only declared ids.
#[derive(Debug)]
struct DeclaredNs {
    inner: Arc<dyn Namespace>,
    ids: Arc<[Arc<str>]>,
}

impl Namespace for DeclaredNs {
    fn get(&self, key: &str) -> Value {
        if self.ids.iter().any(|id| id.as_ref() == key) {
            self.inner.get(key)
        } else {
            Value::Undefined
        }
    }

    fn keys(&self) -> Vec<Arc<str>> {
        self.ids.to_vec()
    }
}
