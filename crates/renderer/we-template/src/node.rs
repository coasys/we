//! [`SchemaNode`]: a node of the authored tree, exactly as the JSON carries it.
//!
//! The declared fields mirror `SchemaNode` in
//! `packages/schema-system/shared/src/types.ts`. Anything else — a handler
//! token in a `children` list, a key a newer schema version adds — lands in
//! [`SchemaNode::extra`] and serializes straight back out, so parsing never
//! loses a field.
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// A raw JSON object whose key order survives (`serde_json` is built with
/// `preserve_order`).
pub type JsonMap = serde_json::Map<String, serde_json::Value>;

/// One node of the authored tree.
///
/// `type` names the component — `Row`, `we-button`, a structure op such as
/// `$if`, or nothing for a fragment. Everything the type means — props,
/// structure-op arguments like `condition`/`then`/`items`, handler tokens —
/// sits in [`SchemaNode::props`] as raw JSON; the resolver reads it, not this
/// type.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SchemaNode {
    /// The node's permanent identity, when an author gave it one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Names the node among its siblings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub ty: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub props: Option<JsonMap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slots: Option<JsonMapOfNodes>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routes: Option<Vec<RouteNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<SchemaChild>>,
    /// Scoped theme overrides, kept raw (`ThemeOverrides` lives in `@we/themes`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<serde_json::Value>,
    /// Raw CSS escape hatch, kept raw.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub styles: Option<JsonMap>,
    #[serde(rename = "$localState", skip_serializing_if = "Option::is_none")]
    pub local_state: Option<JsonMap>,
    #[serde(rename = "$queries", skip_serializing_if = "Option::is_none")]
    pub queries: Option<JsonMap>,
    #[serde(rename = "$defs", skip_serializing_if = "Option::is_none")]
    pub defs: Option<JsonMapOfNodes>,
    #[serde(rename = "forkedFrom", skip_serializing_if = "Option::is_none")]
    pub forked_from: Option<String>,
    #[serde(rename = "forkedPart", skip_serializing_if = "Option::is_none")]
    pub forked_part: Option<serde_json::Value>,
    /// Every key this file does not name — including the `$`-keyed operator
    /// tokens that appear in `children`. Kept verbatim; dropping this field
    /// drops template data.
    #[serde(flatten)]
    pub extra: JsonMap,
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RouteNode {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redirect: Option<String>,
    #[serde(rename = "keepAlive", skip_serializing_if = "Option::is_none")]
    pub keep_alive: Option<bool>,
    #[serde(flatten)]
    pub node: SchemaNode,
}
