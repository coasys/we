//! The resolved tree — what a frame paints.
//!
//! A resolver (task E3) turns a [`crate::SchemaNode`] plus an environment into
//! a [`ResolvedNode`]: structure ops are gone — `$if` leaves its chosen branch,
//! `$each` its expanded rows — props are evaluated [`Value`]s, and handlers are
//! tokens carrying the scope they were written in.
use std::fmt;
use std::sync::Arc;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use smallvec::SmallVec;
use we_expr::Value;

use crate::handler::HandlerToken;
use crate::node::JsonMap;
use crate::query::SlotRef;
use crate::surface::SurfaceTag;

/// A node's stable identity: template id + child path + `$each` keys.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeId(Arc<str>);

impl NodeId {
    pub fn new(id: impl Into<Arc<str>>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NodeId({})", self.0)
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<&str> for NodeId {
    fn from(s: &str) -> Self {
        Self::new(s)
    }
}
impl From<String> for NodeId {
    fn from(s: String) -> Self {
        Self::new(s)
    }
}
impl From<Arc<str>> for NodeId {
    fn from(s: Arc<str>) -> Self {
        Self(s)
    }
}

/// A node of the resolved tree.
#[derive(Debug, Clone)]
pub struct ResolvedNode {
    /// Stable: template id + child path + `$each` keys.
    pub id: NodeId,
    /// Widget type: `"Row"`, `"we-button"`, …
    pub ty: Arc<str>,
    /// Evaluated; design-system props still as authored.
    pub props: IndexMap<Arc<str>, Value>,
    /// `"onClick"` -> token list + captured scope.
    pub handlers: IndexMap<Arc<str>, HandlerRef>,
    pub slot: Option<Arc<str>>,
    /// `Node` children and text runs, in order.
    pub children: Vec<ResolvedChild>,
    /// The surfaces this node answers for — a `$surface`'s own tag, or on
    /// the runtime's synthetic content-viewport wrapper the host tags of
    /// the mounts it frames (E3c-13). Never a mount's host tag on a
    /// template node: the host is the boundary around the template
    /// (`Runtime::host_surfaces`). The frontend reports the node's
    /// content-box width against each; the generation keeps a remount's
    /// measures apart. Identity detail like `id` — not part of the
    /// [`normal_form`].
    pub surfaces: SmallVec<[SurfaceTag; 2]>,
    /// From `$if` / `$animate`; paint-only.
    pub transition: Option<Transition>,
}

/// A resolved child: a node, or a text run an evaluated `{$: "…"}` child left.
#[derive(Debug, Clone)]
pub enum ResolvedChild {
    Node(Box<ResolvedNode>),
    Text(Arc<str>),
}

/// A handler on a resolved node: the tokens it was written as, plus the scope
/// they run against.
#[derive(Debug, Clone)]
pub struct HandlerRef {
    /// The handler's token list, as authored.
    pub tokens: Vec<HandlerToken>,
    /// The bindings in scope where the handler was written.
    pub scope: Scope,
    /// The frame the handler was resolved in (design 4.6.3): dispatch and
    /// any completion it starts run under this authority — never under a
    /// mount the frontend or completer happens to name.
    pub frame: crate::gate::Frame,
}

/// The bindings a handler carries out of the node it was written on:
/// name → value, innermost last. Read before the store bag and the built-ins
/// when the handler runs.
#[derive(Debug, Clone, Default)]
pub struct Scope {
    /// name → value (and the conduit mark, see [`Scope::bind_conduit`]),
    /// innermost last.
    binds: Vec<Bind>,
}

/// One scope binding. `conduit` marks the resolver's synthesized boxes —
/// `local`, a `$surface` measure, `$nav`, an unresolved `$agent` stub —
/// objects the resolve rebuilds every pass where WE keeps one context
/// object alive for the mount: reading the box itself subscribes to
/// nothing, so a tracked initial may not count a rebuilt box as a moved
/// dependency. Reads THROUGH the box (`local.src`, `surface.tier`) remain
/// real dependencies.
#[derive(Debug, Clone)]
struct Bind {
    name: Arc<str>,
    value: Value,
    conduit: bool,
    /// The query slots the value was read out of — an `$each` row of
    /// `local.board` reads the board's slot whatever it is called.
    slots: Arc<[SlotRef]>,
}

impl Scope {
    /// The innermost binding for `name`, if any.
    pub fn get(&self, name: &str) -> Option<&Value> {
        self.binds
            .iter()
            .rev()
            .find(|b| b.name.as_ref() == name)
            .map(|b| &b.value)
    }

    /// Push a binding on top.
    pub fn bind(&mut self, name: impl Into<Arc<str>>, value: Value) {
        self.binds.push(Bind {
            name: name.into(),
            value,
            conduit: false,
            slots: Arc::new([]),
        });
    }

    /// Push a binding whose value came out of the query slots `slots`.
    pub fn bind_from_slots(
        &mut self,
        name: impl Into<Arc<str>>,
        value: Value,
        slots: Arc<[SlotRef]>,
    ) {
        self.binds.push(Bind {
            name: name.into(),
            value,
            conduit: false,
            slots,
        });
    }

    /// The query slots `name`'s innermost binding was read out of.
    pub fn slots_of(&self, name: &str) -> &[SlotRef] {
        self.binds
            .iter()
            .rev()
            .find(|b| b.name.as_ref() == name)
            .map(|b| &*b.slots)
            .unwrap_or(&[])
    }

    /// A synthesized box — the name reads like any binding; the mark only
    /// tells a tracked evaluation that the box is not itself a dependency.
    pub fn bind_conduit(&mut self, name: impl Into<Arc<str>>, value: Value) {
        self.binds.push(Bind {
            name: name.into(),
            value,
            conduit: true,
            slots: Arc::new([]),
        });
    }

    /// Whether `name`'s innermost binding is a conduit box — the check a
    /// tracked read makes before recording a bare root read: `[local]` is
    /// no dependency, `local.src` still is.
    pub fn is_conduit(&self, name: &str) -> bool {
        self.binds
            .iter()
            .rev()
            .find(|b| b.name.as_ref() == name)
            .is_some_and(|b| b.conduit)
    }

    pub fn is_empty(&self) -> bool {
        self.binds.is_empty()
    }

    pub fn len(&self) -> usize {
        self.binds.len()
    }
}

/// What `$if`/`$animate` leave for the painter: enter and exit effect lists,
/// and `$animate`'s open state when it authors a `condition` — the child is
/// mounted either way; the painter draws hidden/visual state from `open`.
#[derive(Debug, Clone, Default)]
pub struct Transition {
    pub enter: Option<Vec<TransitionEffect>>,
    pub exit: Option<Vec<TransitionEffect>>,
    /// `$animate`'s evaluated `condition` (`Some` when authored): the painter
    /// draws the open or hidden style — the subtree is present regardless.
    /// `None` for a mount/scroll-driven animation and for `$if`.
    pub open: Option<bool>,
}

/// One animation effect (`TransitionEffect` in `types.ts`). `distance` is text
/// — `"40px"` for slide, `"0.95"` for scale.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransitionEffect {
    #[serde(rename = "type")]
    pub kind: TransitionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub easing: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis: Option<String>,
    #[serde(flatten)]
    pub extra: JsonMap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransitionKind {
    Fade,
    Slide,
    Scale,
    Reveal,
    Pulse,
}

/// A transition prop as authored — one effect or a list (`TransitionConfig`).
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum AuthoredEffects {
    One(TransitionEffect),
    Many(Vec<TransitionEffect>),
}

impl Transition {
    /// Read `enterTransition`/`exitTransition` out of a node's raw props —
    /// the shape `$animate` and `$if` author them in.
    pub fn from_props(props: &JsonMap) -> Option<Transition> {
        let read = |key: &str| -> Option<Vec<TransitionEffect>> {
            match serde_json::from_value::<AuthoredEffects>(props.get(key)?.clone()) {
                Ok(AuthoredEffects::One(effect)) => Some(vec![effect]),
                Ok(AuthoredEffects::Many(effects)) => Some(effects),
                Err(_) => None,
            }
        };
        let enter = read("enterTransition");
        let exit = read("exitTransition");
        (enter.is_some() || exit.is_some()).then_some(Transition {
            enter,
            exit,
            open: None,
        })
    }
}

/// The normal form of a resolved tree (conformance level 3): plain JSON —
///
/// ```json
/// { "type": "we-button", "props": { "label": "Save" }, "on": ["onClick"],
///   "children": [ { "text": "…" }, { "type": "…" } ] }
/// ```
///
/// `type` is always present; `props`, `on` and `children` appear only when
/// non-empty. Props evaluating to `Undefined` or to a callable are dropped.
/// `on` is the sorted list of handler names. `id`, `transition` and `slot`
/// are not part of it — slot placement shows in `children` order.
pub fn normal_form(node: &ResolvedNode) -> serde_json::Value {
    let mut out = JsonMap::new();
    out.insert(
        "type".to_string(),
        serde_json::Value::String(node.ty.to_string()),
    );

    let props: JsonMap = node
        .props
        .iter()
        .filter(|(_, v)| !matches!(v, Value::Undefined | Value::Callable(_)))
        .map(|(k, v)| (k.to_string(), v.to_json()))
        .collect();
    if !props.is_empty() {
        out.insert("props".to_string(), serde_json::Value::Object(props));
    }

    if !node.handlers.is_empty() {
        let mut names: Vec<String> = node.handlers.keys().map(|k| k.to_string()).collect();
        names.sort();
        out.insert(
            "on".to_string(),
            serde_json::Value::Array(names.into_iter().map(serde_json::Value::String).collect()),
        );
    }

    if !node.children.is_empty() {
        let children: Vec<serde_json::Value> = node
            .children
            .iter()
            .map(|child| match child {
                ResolvedChild::Node(node) => normal_form(node),
                ResolvedChild::Text(text) => {
                    let mut map = JsonMap::new();
                    map.insert(
                        "text".to_string(),
                        serde_json::Value::String(text.to_string()),
                    );
                    serde_json::Value::Object(map)
                }
            })
            .collect();
        out.insert("children".to_string(), serde_json::Value::Array(children));
    }

    serde_json::Value::Object(out)
}
