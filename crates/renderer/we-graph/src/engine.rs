//! Seeds, store merge and one level of auto-expansion.
//!
//! This is the slice of `@we/graph-core` `GraphEngine` the three space views
//! use, calling the same expanders (`schema` seed, `query` seed, `collection`,
//! `entity` forward, `property`, `property-values`) with `DEFAULT_REIFIED_EDGES`.
//! Direction `out` does not run the entity expander's backward pass.
//! `vocabulary-records` returns nothing without a vocabulary seed, so it is
//! not registered. Schema expanders claim only `$schema` / `$instances`, and
//! depth 0 does not expand those nodes.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::address::{
    entity_address, literal_address, parse_address, property_address, SCHEMA_TYPE,
};
use crate::shape::{shape_named, Shape};
use crate::world::{Include, Query, World};

const HOST_MAX_NODES: usize = 20_000;
const DEFAULT_MAX_NODES: usize = 2_000;
const DEFAULT_EXPAND_LIMIT: usize = 50;
const LABEL_CANDIDATES: [&str; 8] = [
    "name",
    "title",
    "label",
    "handle",
    "subgroupName",
    "text",
    "content",
    "textContent",
];
const RECORD_FIELDS: [&str; 2] = ["createdAt", "author"];
const NEVER_CHILDREN: [&str; 1] = ["Placement"];

#[cfg(test)]
mod spec_json {
    use super::{view_from_json, SeedSpec};
    use serde_json::json;

    #[test]
    fn content_props_name_the_collection_expander() {
        let spec = view_from_json(
            &json!({"source": "query", "options": {"entity": "CollectionBlock", "limit": 30}}),
            &json!({"defaultDepth": 1, "direction": "out", "expanders": ["collection"], "maxNodes": 400}),
        )
        .expect("content props");
        match &spec.seeds[0] {
            SeedSpec::Query { entity, limit } => {
                assert_eq!(entity, "CollectionBlock");
                assert_eq!(*limit, 30);
            }
            SeedSpec::Schema => panic!("content is a query seed"),
        }
        assert_eq!(spec.expansion.default_depth, 1);
        assert_eq!(spec.expansion.direction, "out");
        assert_eq!(spec.expansion.max_nodes, Some(400));
        assert_eq!(
            spec.expansion.expanders.as_deref(),
            Some(&["collection".to_string()][..])
        );
    }

    #[test]
    fn unresolved_seed_is_not_a_view() {
        assert!(view_from_json(&json!({"$": "local.seeds"}), &json!({})).is_none());
    }
}

#[derive(Debug, Clone)]
pub enum SeedSpec {
    Schema,
    Query { entity: String, limit: u64 },
}

#[derive(Debug, Clone)]
pub struct Expansion {
    pub default_depth: u32,
    /// `out`, `in`, or `both`. The three views use `out` or do not expand.
    pub direction: &'static str,
    pub limit: Option<u64>,
    pub max_nodes: Option<u64>,
    pub expanders: Option<Vec<String>>,
}

impl Default for Expansion {
    fn default() -> Self {
        Self {
            default_depth: 0,
            direction: "both",
            limit: None,
            max_nodes: None,
            expanders: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ViewSpec {
    pub seeds: Vec<SeedSpec>,
    pub expansion: Expansion,
}

/// The space's shapes. Depth 0, so the map is the vocabulary and its typed edges.
pub fn schema_view() -> ViewSpec {
    ViewSpec {
        seeds: vec![SeedSpec::Schema],
        expansion: Expansion {
            default_depth: 0,
            ..Expansion::default()
        },
    }
}

/// Collections, hand-drawn relationships, and one hop out. Limit 20, ceiling 500.
pub fn knowledge_view() -> ViewSpec {
    ViewSpec {
        seeds: vec![
            SeedSpec::Query {
                entity: "CollectionBlock".into(),
                limit: 40,
            },
            SeedSpec::Query {
                entity: "Relationship".into(),
                limit: 60,
            },
        ],
        expansion: Expansion {
            default_depth: 1,
            direction: "out",
            limit: Some(20),
            max_nodes: Some(500),
            expanders: None,
        },
    }
}

/// Collections and their children. Only the collection expander. Ceiling 400.
pub fn content_view() -> ViewSpec {
    ViewSpec {
        seeds: vec![SeedSpec::Query {
            entity: "CollectionBlock".into(),
            limit: 30,
        }],
        expansion: Expansion {
            default_depth: 1,
            direction: "out",
            limit: None,
            max_nodes: Some(400),
            expanders: Some(vec!["collection".into()]),
        },
    }
}

/// The `seeds` and `expansion` props of a `GraphView`, after the template
/// has resolved them. An unresolved `$` expression is not a view.
///
/// `direction` is only `out`, `in`, or `both`. Anything else is `both`,
/// which is what the engine uses when the prop is omitted.
pub fn view_from_json(seeds: &Value, expansion: &Value) -> Option<ViewSpec> {
    let seeds = parse_seeds(seeds)?;
    Some(ViewSpec {
        seeds,
        expansion: parse_expansion(expansion),
    })
}

fn parse_seeds(value: &Value) -> Option<Vec<SeedSpec>> {
    let seeds: Vec<SeedSpec> = match value {
        Value::Array(items) => items.iter().map(one_seed).collect::<Option<_>>()?,
        other => vec![one_seed(other)?],
    };
    if seeds.is_empty() {
        None
    } else {
        Some(seeds)
    }
}

fn one_seed(value: &Value) -> Option<SeedSpec> {
    let obj = value.as_object()?;
    if obj.len() == 1 && obj.contains_key("$") {
        return None;
    }
    match obj.get("source").and_then(Value::as_str)? {
        "schema" => Some(SeedSpec::Schema),
        "query" => {
            let options = obj.get("options").and_then(Value::as_object)?;
            let entity = options.get("entity").and_then(Value::as_str)?.to_string();
            if entity.is_empty() {
                return None;
            }
            let limit = options
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(1_000_000);
            Some(SeedSpec::Query { entity, limit })
        }
        _ => None,
    }
}

fn static_dir(direction: &str) -> &'static str {
    match direction {
        "out" => "out",
        "in" => "in",
        _ => "both",
    }
}

fn parse_expansion(value: &Value) -> Expansion {
    let Some(obj) = value.as_object() else {
        return Expansion::default();
    };
    if obj.len() == 1 && obj.contains_key("$") {
        return Expansion::default();
    }
    let default_depth = obj
        .get("defaultDepth")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .min(u64::from(u32::MAX)) as u32;
    let direction = obj
        .get("direction")
        .and_then(Value::as_str)
        .map(static_dir)
        .unwrap_or("both");
    let limit = obj.get("limit").and_then(Value::as_u64);
    let max_nodes = obj.get("maxNodes").and_then(Value::as_u64);
    let expanders = obj.get("expanders").and_then(Value::as_array).map(|items| {
        items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect()
    });
    Expansion {
        default_depth,
        direction,
        limit,
        max_nodes,
        expanders,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Node {
    pub id: String,
    pub kind: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Map<String, Value>>,
    #[serde(skip_serializing_if = "is_false")]
    pub unresolved: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Edge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub ty: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Map<String, Value>>,
    #[serde(rename = "reifiedAs", skip_serializing_if = "Option::is_none")]
    pub reified_as: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

struct Store {
    nodes: Vec<Node>,
    index: HashMap<String, usize>,
    edges: Vec<Edge>,
    edge_index: HashMap<String, usize>,
}

impl Store {
    fn new() -> Self {
        Self {
            nodes: Vec::new(),
            index: HashMap::new(),
            edges: Vec::new(),
            edge_index: HashMap::new(),
        }
    }

    fn node_count(&self) -> usize {
        self.nodes.len()
    }

    fn merge(&mut self, nodes: &[Node], edges: &[Edge]) {
        for node in nodes {
            if let Some(&i) = self.index.get(&node.id) {
                self.nodes[i] = merge_node(&self.nodes[i], node);
            } else {
                self.index.insert(node.id.clone(), self.nodes.len());
                self.nodes.push(node.clone());
            }
        }
        for edge in edges {
            if !self.index.contains_key(&edge.source) || !self.index.contains_key(&edge.target) {
                continue;
            }
            if let Some(&i) = self.edge_index.get(&edge.id) {
                self.edges[i] = edge.clone();
            } else {
                self.edge_index.insert(edge.id.clone(), self.edges.len());
                self.edges.push(edge.clone());
            }
        }
    }
}

/// A resolved node never becomes unresolved. A later sighting overwrites the
/// label, including a placeholder's class name (`mergeNode` in `store.ts`).
fn merge_node(existing: &Node, incoming: &Node) -> Node {
    let resolved = !existing.unresolved || !incoming.unresolved;
    let data = match (&existing.data, &incoming.data) {
        (None, None) => None,
        (a, b) => {
            let mut m = a.clone().unwrap_or_default();
            if let Some(b) = b {
                for (k, v) in b {
                    m.insert(k.clone(), v.clone());
                }
            }
            Some(m)
        }
    };
    Node {
        id: incoming.id.clone(),
        kind: incoming.kind.clone(),
        ty: incoming.ty.clone(),
        label: incoming.label.clone(),
        data,
        unresolved: !resolved,
        source: incoming.source.clone(),
    }
}

pub fn build(world: &World, shapes: &[Shape], dataset: &str, view: &ViewSpec) -> Graph {
    let mut store = Store::new();
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for seed in &view.seeds {
        let (n, e) = match seed {
            SeedSpec::Schema => schema_seed(shapes, dataset),
            SeedSpec::Query { entity, limit } => query_seed(world, shapes, dataset, entity, *limit),
        };
        nodes.extend(n);
        edges.extend(e);
    }
    store.merge(&nodes, &edges);

    let depth = view.expansion.default_depth;
    if depth > 0 {
        let max_nodes = max_nodes(&view.expansion);
        let limit = view
            .expansion
            .limit
            .map(|n| n as usize)
            .unwrap_or(DEFAULT_EXPAND_LIMIT);
        let direction = view.expansion.direction;
        let mut expanded = HashMap::<String, ()>::new();
        let frontier: Vec<String> = store.nodes.iter().map(|n| n.id.clone()).collect();
        for id in frontier {
            if store.node_count() >= max_nodes {
                break;
            }
            if expanded.contains_key(&id) {
                continue;
            }
            let Some(node) = store.index.get(&id).map(|&i| store.nodes[i].clone()) else {
                continue;
            };
            if node.kind != "entity" {
                continue;
            }
            expand_node(
                &mut store,
                world,
                shapes,
                dataset,
                &node,
                direction,
                limit,
                max_nodes,
                view.expansion.expanders.as_deref(),
            );
            expanded.insert(id, ());
        }
    }

    Graph {
        nodes: store.nodes,
        edges: store.edges,
    }
}

fn is_false(v: &bool) -> bool {
    !*v
}

fn max_nodes(expansion: &Expansion) -> usize {
    let asked = expansion.max_nodes.unwrap_or(DEFAULT_MAX_NODES as u64) as usize;
    asked.clamp(1, HOST_MAX_NODES)
}

#[allow(clippy::too_many_arguments)]
fn expand_node(
    store: &mut Store,
    world: &World,
    shapes: &[Shape],
    dataset: &str,
    node: &Node,
    direction: &str,
    limit: usize,
    max_nodes: usize,
    enabled: Option<&[String]>,
) {
    // Priority descending, registration order on a tie: collection, entity, property, property-values.
    let steps: &[(&str, u8)] = &[
        ("collection", 10),
        ("entity", 0),
        ("property", 1),
        ("property-values", 2),
    ];
    for (id, _) in steps {
        if enabled.is_some_and(|list| !list.iter().any(|n| n == id)) {
            continue;
        }
        if *id == "collection" && node.ty != "CollectionBlock" {
            continue;
        }
        let (nodes, edges) = match *id {
            "collection" => collection_expand(world, shapes, dataset, node, direction, limit),
            "entity" => entity_expand(world, shapes, dataset, node, direction, limit),
            "property" => property_expand(world, shapes, dataset, node, false),
            "property-values" => property_expand(world, shapes, dataset, node, true),
            _ => (Vec::new(), Vec::new()),
        };
        let room = max_nodes.saturating_sub(store.node_count());
        let nodes = if nodes.len() <= room {
            nodes
        } else {
            nodes.into_iter().take(room).collect()
        };
        store.merge(&nodes, &edges);
    }
}

fn schema_seed(shapes: &[Shape], dataset: &str) -> (Vec<Node>, Vec<Edge>) {
    let nodes: Vec<Node> = shapes
        .iter()
        .map(|shape| {
            let mut data = Map::new();
            data.insert("entity".into(), Value::String(shape.name.clone()));
            data.insert(
                "properties".into(),
                Value::from(shape.properties.len() as u64),
            );
            data.insert(
                "relations".into(),
                Value::from(shape.relations.len() as u64),
            );
            // `toEntityShape` does not copy `description`, so the seed writes null.
            data.insert("description".into(), Value::Null);
            Node {
                id: entity_address(dataset, SCHEMA_TYPE, &shape.name),
                kind: "entity".into(),
                ty: SCHEMA_TYPE.into(),
                label: shape.name.clone(),
                data: Some(data),
                unresolved: false,
                source: "schema".into(),
            }
        })
        .collect();
    let known: std::collections::HashSet<&str> = shapes.iter().map(|s| s.name.as_str()).collect();
    let mut edges = Vec::new();
    for shape in shapes {
        for relation in &shape.relations {
            if !known.contains(relation.target.as_str()) {
                continue;
            }
            let source = entity_address(dataset, SCHEMA_TYPE, &shape.name);
            let target = entity_address(dataset, SCHEMA_TYPE, &relation.target);
            let mut data = Map::new();
            data.insert(
                "cardinality".into(),
                Value::String(relation.cardinality.clone()),
            );
            edges.push(Edge {
                id: edge_id(&source, &relation.name, &target),
                source,
                target,
                ty: relation.name.clone(),
                label: Some(relation.name.clone()),
                data: Some(data),
                reified_as: None,
            });
        }
    }
    (nodes, edges)
}

fn query_seed(
    world: &World,
    shapes: &[Shape],
    dataset: &str,
    entity: &str,
    limit: u64,
) -> (Vec<Node>, Vec<Edge>) {
    let shape = shape_named(shapes, entity);
    if is_reified(entity) {
        let spec = reified_spec(entity).unwrap();
        let include = vec![
            Include {
                name: spec.source.into(),
                nested: vec![],
            },
            Include {
                name: spec.target.into(),
                nested: vec![],
            },
        ];
        let rows = world.query(
            shapes,
            &Query {
                entity: entity.into(),
                id: None,
                limit: Some(limit as usize),
                include,
            },
        );
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        for row in rows {
            if let Some((ns, edge)) = reified_edge(&row, entity, &spec, dataset, shapes, "query") {
                nodes.extend(ns);
                edges.push(edge);
            }
        }
        return (nodes, edges);
    }
    let rows = world.query(
        shapes,
        &Query {
            entity: entity.into(),
            id: None,
            limit: Some(limit as usize),
            include: vec![],
        },
    );
    let nodes = rows
        .iter()
        .filter_map(|row| row_to_node(row, entity, dataset, shape, "query"))
        .collect();
    (nodes, Vec::new())
}

fn collection_expand(
    world: &World,
    shapes: &[Shape],
    dataset: &str,
    node: &Node,
    direction: &str,
    limit: usize,
) -> (Vec<Node>, Vec<Edge>) {
    if direction == "in" {
        return (Vec::new(), Vec::new());
    }
    let Some(parsed) = parse_address(&node.id) else {
        return (Vec::new(), Vec::new());
    };
    if parsed.kind != "entity" {
        return (Vec::new(), Vec::new());
    }
    let rows = world.query(
        shapes,
        &Query {
            entity: parsed.ty.clone(),
            id: Some(parsed.id.clone()),
            limit: Some(1),
            include: vec![Include {
                name: "children".into(),
                nested: vec![],
            }],
        },
    );
    let Some(parent) = rows.first().and_then(Value::as_object) else {
        return (Vec::new(), Vec::new());
    };
    let members = parent
        .get("children")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for row in members.iter().take(limit) {
        let Some(child_ty) = row
            .get(crate::address::NODE_TYPE_KEY)
            .and_then(Value::as_str)
        else {
            continue;
        };
        if NEVER_CHILDREN.contains(&child_ty) {
            continue;
        }
        let Some(child) = row_to_node(
            row,
            child_ty,
            dataset,
            shape_named(shapes, child_ty),
            "collection",
        ) else {
            continue;
        };
        edges.push(Edge {
            id: edge_id(&node.id, "contains", &child.id),
            source: node.id.clone(),
            target: child.id.clone(),
            ty: "contains".into(),
            label: None,
            data: None,
            reified_as: None,
        });
        nodes.push(child);
    }
    (nodes, edges)
}

fn entity_expand(
    world: &World,
    shapes: &[Shape],
    dataset: &str,
    node: &Node,
    direction: &str,
    limit: usize,
) -> (Vec<Node>, Vec<Edge>) {
    if direction == "in" {
        return (Vec::new(), Vec::new());
    }
    let Some(parsed) = parse_address(&node.id) else {
        return (Vec::new(), Vec::new());
    };
    let Some(shape) = shape_named(shapes, &parsed.ty) else {
        return (Vec::new(), Vec::new());
    };
    let relations: Vec<_> = shape
        .relations
        .iter()
        .filter(|r| !r.target.is_empty())
        .collect();
    if relations.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let include = relations
        .iter()
        .map(|r| {
            let nested = if is_reified(&r.target) {
                reified_spec(&r.target)
                    .map(|spec| {
                        vec![
                            Include {
                                name: spec.source.into(),
                                nested: vec![],
                            },
                            Include {
                                name: spec.target.into(),
                                nested: vec![],
                            },
                        ]
                    })
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            Include {
                name: r.name.clone(),
                nested,
            }
        })
        .collect();
    let rows = world.query(
        shapes,
        &Query {
            entity: parsed.ty.clone(),
            id: Some(parsed.id),
            limit: Some(1),
            include,
        },
    );
    let Some(row) = rows.first().and_then(Value::as_object) else {
        return (Vec::new(), Vec::new());
    };
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for relation in relations {
        let value = row.get(&relation.name);
        let targets: Vec<&Value> = match value {
            Some(Value::Array(items)) => items.iter().collect(),
            Some(Value::Null) | None => Vec::new(),
            Some(other) => vec![other],
        };
        for target in targets.into_iter().take(limit) {
            if is_reified(&relation.target) && target.is_object() {
                if let Some((ns, edge)) = reified_spec(&relation.target).and_then(|spec| {
                    reified_edge(target, &relation.target, &spec, dataset, shapes, "entity")
                }) {
                    nodes.extend(ns);
                    edges.push(edge);
                    continue;
                }
            }
            let made = if target.is_object() {
                row_to_node(
                    target,
                    &relation.target,
                    dataset,
                    shape_named(shapes, &relation.target),
                    "entity",
                )
            } else {
                target
                    .as_str()
                    .map(|id| placeholder(dataset, &relation.target, id, "entity"))
            };
            let Some(made) = made else { continue };
            edges.push(Edge {
                id: edge_id(&node.id, &relation.name, &made.id),
                source: node.id.clone(),
                target: made.id.clone(),
                ty: relation.name.clone(),
                label: None,
                data: None,
                reified_as: None,
            });
            nodes.push(made);
        }
    }
    (nodes, edges)
}

fn property_expand(
    world: &World,
    shapes: &[Shape],
    dataset: &str,
    node: &Node,
    value_nodes: bool,
) -> (Vec<Node>, Vec<Edge>) {
    let Some(parsed) = parse_address(&node.id) else {
        return (Vec::new(), Vec::new());
    };
    if parsed.kind != "entity" {
        return (Vec::new(), Vec::new());
    }
    let Some(shape) = shape_named(shapes, &parsed.ty) else {
        return (Vec::new(), Vec::new());
    };
    let skip = if value_nodes {
        label_property(shape)
    } else {
        None
    };
    let fields: Vec<_> = shape
        .properties
        .iter()
        .filter(|p| skip.as_deref() != Some(p.name.as_str()))
        .collect();
    if fields.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let rows = world.query(
        shapes,
        &Query {
            entity: shape.name.clone(),
            id: Some(parsed.id.clone()),
            limit: Some(1),
            include: vec![],
        },
    );
    let Some(row) = rows.first().and_then(Value::as_object) else {
        return (Vec::new(), Vec::new());
    };
    let source = if value_nodes {
        "property-values"
    } else {
        "property"
    };
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for field in fields {
        let value = row.get(&field.name);
        if hide_empty(value) {
            continue;
        }
        let value = value.unwrap();
        let property_id = property_address(dataset, &parsed.ty, &parsed.id, &field.name);
        let mut data = Map::new();
        data.insert("value".into(), as_scalar(value));
        nodes.push(Node {
            id: property_id.clone(),
            kind: "property".into(),
            ty: field.name.clone(),
            label: if value_nodes {
                field.name.clone()
            } else {
                format!("{}: {}", field.name, format_value(value))
            },
            data: Some(data.clone()),
            unresolved: false,
            source: source.into(),
        });
        edges.push(Edge {
            id: edge_id(&node.id, &field.name, &property_id),
            source: node.id.clone(),
            target: property_id.clone(),
            ty: "property".into(),
            label: Some("property".into()),
            data: None,
            reified_as: None,
        });
        if !value_nodes || value.is_null() {
            continue;
        }
        let scalar = as_scalar(value);
        let text = match &scalar {
            Value::String(s) => s.clone(),
            Value::Bool(b) => b.to_string(),
            Value::Number(n) => js_number(n),
            Value::Null => String::new(),
            other => other.to_string(),
        };
        let literal_id = literal_address(&text);
        let mut ldata = Map::new();
        ldata.insert("value".into(), scalar);
        nodes.push(Node {
            id: literal_id.clone(),
            kind: "literal".into(),
            ty: field.ty.clone(),
            label: format_value(value),
            data: Some(ldata),
            unresolved: false,
            source: source.into(),
        });
        edges.push(Edge {
            id: edge_id(&property_id, "value", &literal_id),
            source: property_id,
            target: literal_id,
            ty: "value".into(),
            label: None,
            data: None,
            reified_as: None,
        });
    }
    (nodes, edges)
}

fn hide_empty(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) if s.is_empty() => true,
        _ => false,
    }
}

struct Reified {
    source: &'static str,
    target: &'static str,
    ty: &'static str,
    source_type: Option<&'static str>,
    target_type: Option<&'static str>,
}

fn is_reified(entity: &str) -> bool {
    matches!(entity, "Relationship" | "SemanticRelationship")
}

fn reified_spec(entity: &str) -> Option<Reified> {
    match entity {
        "SemanticRelationship" => Some(Reified {
            source: "expression",
            target: "tag",
            ty: "tagged",
            source_type: None,
            target_type: None,
        }),
        "Relationship" => Some(Reified {
            source: "source",
            target: "target",
            ty: "relates",
            source_type: Some("sourceType"),
            target_type: Some("targetType"),
        }),
        _ => None,
    }
}

fn reified_edge(
    row: &Value,
    entity: &str,
    spec: &Reified,
    dataset: &str,
    shapes: &[Shape],
    source_id: &str,
) -> Option<(Vec<Node>, Edge)> {
    let row = row.as_object()?;
    let id = row.get("id").and_then(Value::as_str)?;
    let shape = shape_named(shapes, entity)?;
    let source_rel = shape.relation(spec.source)?;
    let target_rel = shape.relation(spec.target)?;
    let source_entity = endpoint_type(row, source_rel, spec.source, spec.source_type)?;
    let target_entity = endpoint_type(row, target_rel, spec.target, spec.target_type)?;
    let from = endpoint(
        row.get(spec.source)?,
        &source_entity,
        dataset,
        shapes,
        source_id,
    )?;
    let to = endpoint(
        row.get(spec.target)?,
        &target_entity,
        dataset,
        shapes,
        source_id,
    )?;
    let mut data = Map::new();
    for property in &shape.properties {
        if let Some(value) = row.get(&property.name) {
            if matches!(
                value,
                Value::Null | Value::String(_) | Value::Number(_) | Value::Bool(_)
            ) {
                data.insert(property.name.clone(), value.clone());
            }
        }
    }
    let label_key = label_property(shape);
    let label = label_key
        .as_ref()
        .and_then(|k| row.get(k).and_then(Value::as_str).map(str::to_string));
    let edge = Edge {
        id: format!("reified|{}", entity_address(dataset, entity, id)),
        source: from.id.clone(),
        target: to.id.clone(),
        ty: spec.ty.into(),
        label,
        data: Some(data),
        reified_as: Some(entity_address(dataset, entity, id)),
    };
    Some((vec![from, to], edge))
}

fn endpoint_type(
    row: &Map<String, Value>,
    relation: &crate::shape::Rel,
    name: &str,
    type_prop: Option<&str>,
) -> Option<String> {
    if !relation.target.is_empty() {
        return Some(relation.target.clone());
    }
    if let Some(prop) = type_prop {
        if let Some(s) = row.get(prop).and_then(Value::as_str) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    row.get(name)
        .and_then(|v| v.get(crate::address::NODE_TYPE_KEY))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn endpoint(
    value: &Value,
    entity: &str,
    dataset: &str,
    shapes: &[Shape],
    source: &str,
) -> Option<Node> {
    match value {
        Value::String(id) => Some(placeholder(dataset, entity, id, source)),
        Value::Object(_) => {
            row_to_node(value, entity, dataset, shape_named(shapes, entity), source)
        }
        _ => None,
    }
}

fn row_to_node(
    row: &Value,
    entity: &str,
    dataset: &str,
    shape: Option<&Shape>,
    source: &str,
) -> Option<Node> {
    let obj = row.as_object()?;
    let id = obj.get("id").and_then(Value::as_str)?;
    let label_key = shape.and_then(label_property);
    let label = label_key
        .as_ref()
        .and_then(|k| obj.get(k).and_then(trim))
        .or_else(|| obj.get("name").and_then(trim))
        .unwrap_or_else(|| entity.to_string());
    let mut data = scalars(obj, shape);
    data.insert("recordId".into(), Value::String(id.to_string()));
    Some(Node {
        id: entity_address(dataset, entity, id),
        kind: "entity".into(),
        ty: entity.into(),
        label,
        data: Some(data),
        unresolved: false,
        source: source.into(),
    })
}

fn placeholder(dataset: &str, entity: &str, id: &str, source: &str) -> Node {
    Node {
        id: entity_address(dataset, entity, id),
        kind: "entity".into(),
        ty: entity.into(),
        label: entity.into(),
        data: None,
        unresolved: true,
        source: source.into(),
    }
}

fn scalars(row: &Map<String, Value>, shape: Option<&Shape>) -> Map<String, Value> {
    let allowed: Option<std::collections::HashSet<&str>> = shape.map(|s| {
        s.properties
            .iter()
            .map(|p| p.name.as_str())
            .chain(RECORD_FIELDS)
            .collect()
    });
    let mut result = Map::new();
    for (key, value) in row {
        if allowed
            .as_ref()
            .is_some_and(|set| !set.contains(key.as_str()))
        {
            continue;
        }
        if matches!(
            value,
            Value::Null | Value::String(_) | Value::Number(_) | Value::Bool(_)
        ) {
            result.insert(key.clone(), value.clone());
        }
    }
    result
}

fn label_property(shape: &Shape) -> Option<String> {
    if let Some(name) = &shape.name_property {
        if !name.is_empty() {
            return Some(name.clone());
        }
    }
    let names: std::collections::HashSet<&str> =
        shape.properties.iter().map(|p| p.name.as_str()).collect();
    for candidate in LABEL_CANDIDATES {
        if names.contains(candidate) {
            return Some(candidate.into());
        }
    }
    shape
        .properties
        .iter()
        .find(|p| p.ty == "string" && p.required)
        .map(|p| p.name.clone())
}

fn trim(value: &Value) -> Option<String> {
    let text = match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => js_number(n),
        Value::Bool(b) => b.to_string(),
        _ => return None,
    };
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(clip(text, 300, 297))
}

fn format_value(value: &Value) -> String {
    let text = match value {
        Value::Null => "—".into(),
        Value::String(s) => s.clone(),
        Value::Number(n) => js_number(n),
        Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    };
    clip(&text, 40, 37)
}

fn clip(text: &str, max: usize, keep: usize) -> String {
    let count = text.chars().count();
    if count > max {
        let head: String = text.chars().take(keep).collect();
        format!("{head}…")
    } else {
        text.to_string()
    }
}

fn as_scalar(value: &Value) -> Value {
    match value {
        Value::Null | Value::String(_) | Value::Number(_) | Value::Bool(_) => value.clone(),
        other => Value::String(other.to_string()),
    }
}

fn js_number(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    n.as_f64()
        .map(|f| f.to_string())
        .unwrap_or_else(|| n.to_string())
}

fn edge_id(source: &str, ty: &str, target: &str) -> String {
    format!("{source}|{ty}|{target}")
}
