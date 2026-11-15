//! `Gate` — the one deny-by-default check for every capability the
//! renderer answers (design 4.6). Core never decides; it asks. This file
//! holds the E3c-8a read half — `root` / `member` / `screen_read` /
//! `dataset` — plus the nested-authority frame stack (4.6.3) and the
//! member-filtering namespaces the bounds wear. `screen_verb` and
//! `action` land with E3c-8b.
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
use std::sync::{Arc, Mutex, MutexGuard};

use we_expr::{MountCx, Namespace, Tier, Value};

use crate::bindings::{Bound, MemberRule, MemberTiers, RootDomain};
use crate::query::DatasetSel;

/// Proof the gate allowed a read — only `Gate` methods mint one, so a
/// callsite cannot mark its own request allowed (Lal: permit issuance and
/// execution stay together).
#[derive(Debug, Clone, Copy)]
pub struct Permit(());

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
        Declared {
            panels: ids("panels"),
            dialogs: ids("dialogs"),
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

/// What a served wrapper is keyed by — the root name, the asking mount,
/// and the inner namespace's identity.
#[derive(Debug, PartialEq, Eq, Hash)]
struct ServeKey {
    name: Arc<str>,
    mount: Arc<str>,
    tier: Tier,
    panels: Arc<[Arc<str>]>,
    dialogs: Arc<[Arc<str>]>,
    inner: usize,
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
        self.denials().insert(Denial {
            mount: auth.mount.as_str().into(),
            what: what.into(),
        });
        Verdict::Deny
    }

    fn allow(&self) -> Verdict {
        Verdict::Allow(Permit(()))
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
                    inner: Arc::as_ptr(&inner) as *const () as usize,
                };
                let mut served = self.served.lock().unwrap_or_else(|p| p.into_inner());
                Some(
                    served
                        .entry(key)
                        .or_insert_with(|| {
                            Value::namespace(FilteredNs {
                                inner,
                                tiers,
                                auth: auth.clone(),
                                declared: declared.clone(),
                                gate: self.clone(),
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
}

// ── the screen member table ──────────────────────────────────────────

/// `screen`'s member table (design 4.2): the space tier sees the route,
/// the params, this template's own panels and dialogs, and the two layout
/// facts Coasys' space template reads (`layoutDirty`, `collapsedLanes`);
/// overlays, dock, space settings and the theme fork are chrome's. The
/// ONE screen policy (E3c-8a r2, F2): `we-legacy` serves every old
/// spelling of a screen fact through this table. The same table is shared
/// across `screen.<member>`, `screen.nav|shell|theme.<member>` because
/// the view flattens the three bags onto the root — a member is either
/// reachable at a tier or it is not.
pub fn screen_tiers() -> MemberTiers {
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
    for m in ["layoutDirty", "collapsedLanes"] {
        nav_member(&mut shell, m);
    }
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
                members: MemberTiers {
                    members: inner.clone(),
                },
            },
        );
        // The flattened spelling: `screen.params` reads `screen.nav.params`.
        for (m, rule) in inner {
            members.entry(Arc::from(m.as_ref())).or_insert(rule);
        }
    }
    MemberTiers { members }
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
    gate: Arc<Gate>,
    /// Wrapped children by member name — `screen.nav` must answer one
    /// identity per read, same as the root (see `Gate::served`).
    memo: Mutex<HashMap<Arc<str>, Value>>,
}

impl Namespace for FilteredNs {
    fn get(&self, key: &str) -> Value {
        match self
            .gate
            .member(&self.auth, key, self.tiers.rule(key), &self.declared)
        {
            MemberVerdict::Deny => Value::Undefined,
            MemberVerdict::Plain => self.inner.get(key),
            MemberVerdict::Container(tiers) => match self.inner.get(key) {
                Value::Namespace(ns) => {
                    let mut memo = self.memo.lock().unwrap_or_else(|p| p.into_inner());
                    memo.entry(key.into())
                        .or_insert_with(|| {
                            Value::namespace(FilteredNs {
                                inner: ns,
                                tiers,
                                auth: self.auth.clone(),
                                declared: self.declared.clone(),
                                gate: self.gate.clone(),
                                memo: Mutex::new(HashMap::new()),
                            })
                        })
                        .clone()
                }
                _ => Value::Undefined,
            },
            MemberVerdict::Ids(ids) => match self.inner.get(key) {
                Value::Namespace(ns) => {
                    let mut memo = self.memo.lock().unwrap_or_else(|p| p.into_inner());
                    memo.entry(key.into())
                        .or_insert_with(|| Value::namespace(DeclaredNs { inner: ns, ids }))
                        .clone()
                }
                other => other,
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
                | MemberRule::DeclaredIds { tier } => self.auth.tier >= *tier,
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
