//! [`SchemaNode`]: a node of the authored tree, exactly as the JSON carries it.
//!
//! The declared fields mirror `SchemaNode` in
//! `packages/schema-system/shared/src/types.ts`. Anything else — a handler
//! token in a `children` list, a key a newer schema version adds — lands in
//! [`SchemaNode::extra`] and serializes straight back out, so parsing never
//! loses a field. Key order is part of the data: serde impls are hand-written
//! ([`crate::order`]) so an authored `{id, type, meta, props, children}` keeps
//! its `meta` where the author put it instead of flattening to the end.
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::order::{field, ordered_object, push, required, rest_of, serialize_ordered};

/// A raw JSON object whose key order survives (`serde_json` is built with
/// `preserve_order`).
pub type JsonMap = serde_json::Map<String, serde_json::Value>;

/// The wire names [`SchemaNode`] knows, in declaration order — what splits
/// `extra` off, and the write order for a node built in code.
const NODE_FIELDS: &[&str] = &[
    "id",
    "key",
    "type",
    "props",
    "slots",
    "slot",
    "routes",
    "children",
    "theme",
    "styles",
    "$localState",
    "$queries",
    "$defs",
    "forkedFrom",
    "forkedPart",
];

/// One node of the authored tree.
///
/// `type` names the component — `Row`, `we-button`, a structure op such as
/// `$if`, or nothing for a fragment. Everything the type means — props,
/// structure-op arguments like `condition`/`then`/`items`, handler tokens —
/// sits in [`SchemaNode::props`] as raw JSON; the resolver reads it, not this
/// type.
#[derive(Debug, Clone, Default)]
pub struct SchemaNode {
    /// The node's permanent identity, when an author gave it one.
    pub id: Option<String>,
    /// Names the node among its siblings.
    pub key: Option<String>,
    /// Renamed at serde: `type` on the wire.
    pub ty: Option<String>,
    pub props: Option<JsonMap>,
    pub slots: Option<JsonMapOfNodes>,
    pub slot: Option<String>,
    pub routes: Option<Vec<RouteNode>>,
    pub children: Option<Vec<SchemaChild>>,
    /// Scoped theme overrides, kept raw (`ThemeOverrides` lives in `@we/themes`).
    pub theme: Option<serde_json::Value>,
    /// Raw CSS escape hatch, kept raw.
    pub styles: Option<JsonMap>,
    /// Renamed at serde: `$localState` on the wire.
    pub local_state: Option<JsonMap>,
    /// Renamed at serde: `$queries` on the wire.
    pub queries: Option<JsonMap>,
    /// Renamed at serde: `$defs` on the wire.
    pub defs: Option<JsonMapOfNodes>,
    /// Renamed at serde: `forkedFrom` on the wire.
    pub forked_from: Option<String>,
    /// Renamed at serde: `forkedPart` on the wire.
    pub forked_part: Option<serde_json::Value>,
    /// Every key this file does not name — including the `$`-keyed operator
    /// tokens that appear in `children`. Kept verbatim; dropping this field
    /// drops template data.
    pub extra: JsonMap,
    /// The authored key sequence, recorded at parse so the node writes its
    /// keys back where the author put them. Empty for a node built in code —
    /// it writes in declaration order. See [`crate::order`].
    #[doc(hidden)]
    pub key_order: Vec<String>,
}

/// A map of nodes — `slots`, `$defs` — key order kept.
pub type JsonMapOfNodes = indexmap::IndexMap<String, SchemaNode>;

impl SchemaNode {
    /// `Some(expr)` when this "node" is in fact an expression token —
    /// `{ "$": "…" }` in a `children` list — which arrives as an `extra`-only
    /// node so it round-trips exactly. The resolver treats it as text to
    /// evaluate, never as a component.
    pub fn expression_token(&self) -> Option<&str> {
        if self.ty.is_some() || self.extra.len() != 1 {
            return None;
        }
        self.extra.get("$")?.as_str()
    }
}

impl Serialize for SchemaNode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut named = Vec::with_capacity(NODE_FIELDS.len());
        push(&mut named, "id", &self.id);
        push(&mut named, "key", &self.key);
        push(&mut named, "type", &self.ty);
        push(&mut named, "props", &self.props);
        push(&mut named, "slots", &self.slots);
        push(&mut named, "slot", &self.slot);
        push(&mut named, "routes", &self.routes);
        push(&mut named, "children", &self.children);
        push(&mut named, "theme", &self.theme);
        push(&mut named, "styles", &self.styles);
        push(&mut named, "$localState", &self.local_state);
        push(&mut named, "$queries", &self.queries);
        push(&mut named, "$defs", &self.defs);
        push(&mut named, "forkedFrom", &self.forked_from);
        push(&mut named, "forkedPart", &self.forked_part);
        serialize_ordered(&self.key_order, named, &self.extra, serializer)
    }
}

impl<'de> Deserialize<'de> for SchemaNode {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let (key_order, map) = ordered_object(deserializer)?;
        Ok(SchemaNode {
            id: field::<D, _>(&map, "id")?,
            key: field::<D, _>(&map, "key")?,
            ty: field::<D, _>(&map, "type")?,
            props: field::<D, _>(&map, "props")?,
            slots: field::<D, _>(&map, "slots")?,
            slot: field::<D, _>(&map, "slot")?,
            routes: field::<D, _>(&map, "routes")?,
            children: field::<D, _>(&map, "children")?,
            theme: field::<D, _>(&map, "theme")?,
            styles: field::<D, _>(&map, "styles")?,
            local_state: field::<D, _>(&map, "$localState")?,
            queries: field::<D, _>(&map, "$queries")?,
            defs: field::<D, _>(&map, "$defs")?,
            forked_from: field::<D, _>(&map, "forkedFrom")?,
            forked_part: field::<D, _>(&map, "forkedPart")?,
            extra: rest_of(&map, NODE_FIELDS),
            key_order,
        })
    }
}

/// One element of a node's `children`: a node or a text run.
///
/// `types.ts` also permits operator tokens here; they deserialize into
/// [`SchemaChild::Node`] carrying their keys in [`SchemaNode::extra`] — see
/// [`SchemaNode::expression_token`].
#[derive(Debug, Clone)]
pub enum SchemaChild {
    Node(Box<SchemaNode>),
    Text(String),
}

impl<'de> Deserialize<'de> for SchemaChild {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match serde_json::Value::deserialize(deserializer)? {
            serde_json::Value::String(text) => Ok(SchemaChild::Text(text)),
            value @ serde_json::Value::Object(_) => Ok(SchemaChild::Node(Box::new(
                SchemaNode::deserialize(value).map_err(serde::de::Error::custom)?,
            ))),
            other => Err(serde::de::Error::custom(format!(
                "a child must be a node or text, got {other}"
            ))),
        }
    }
}

impl Serialize for SchemaChild {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            SchemaChild::Node(node) => node.serialize(serializer),
            SchemaChild::Text(text) => text.serialize(serializer),
        }
    }
}

/// A route entry (`RouteSchema` in `types.ts`): a node with a path, and
/// optionally a redirect or a keep-alive flag.
#[derive(Debug, Clone, Default)]
pub struct RouteNode {
    pub path: String,
    pub redirect: Option<String>,
    /// Renamed at serde: `keepAlive` on the wire.
    pub keep_alive: Option<bool>,
    /// The route's node body — everything `path`/`redirect`/`keepAlive` is
    /// not. Its own `key_order` keeps its keys in authored order inside it.
    pub node: SchemaNode,
    /// Authored key order across the whole route object — [`SchemaNode::key_order`].
    #[doc(hidden)]
    pub key_order: Vec<String>,
}

/// The route-level keys — the rest of the object is the node body.
const ROUTE_FIELDS: &[&str] = &["path", "redirect", "keepAlive"];

impl Serialize for RouteNode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut named = Vec::with_capacity(ROUTE_FIELDS.len());
        crate::order::push_required(&mut named, "path", &self.path);
        push(&mut named, "redirect", &self.redirect);
        push(&mut named, "keepAlive", &self.keep_alive);
        let serde_json::Value::Object(node) = crate::order::json(&self.node) else {
            unreachable!("a node serializes to an object");
        };
        serialize_ordered(&self.key_order, named, &node, serializer)
    }
}

impl<'de> Deserialize<'de> for RouteNode {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let (key_order, map) = ordered_object(deserializer)?;
        let node = SchemaNode::deserialize(serde_json::Value::Object(rest_of(&map, ROUTE_FIELDS)))
            .map_err(serde::de::Error::custom)?;
        Ok(RouteNode {
            path: required::<D, _>(&map, "path")?,
            redirect: field::<D, _>(&map, "redirect")?,
            keep_alive: field::<D, _>(&map, "keepAlive")?,
            node,
            key_order,
        })
    }
}
