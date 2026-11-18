//! The fixture graph matches the TypeScript `GraphEngine` on the same rows.
//!
//! The golden file is the real engine (`packages/graph-system`) with
//! `defaultExpanders({ reified: DEFAULT_REIFIED_EDGES })` and the three view
//! specs from `GraphView/index.ts`. Regenerating it is a tsx harness over
//! those sources. This test fails when the Rust port disagrees.

use std::collections::BTreeMap;

use serde_json::Value;
use we_graph::{
    build, coasys_world, content_view, core_shapes, knowledge_view, schema_view, FIXTURE_DATASET,
};

#[test]
fn force_positions_stay_finite() {
    use we_graph::{layout_force, LayoutEdge, LayoutNode};
    let world = coasys_world();
    let shapes = core_shapes();
    for (name, spec) in [
        ("schema", schema_view()),
        ("knowledge", knowledge_view()),
        ("content", content_view()),
    ] {
        let graph = build(&world, shapes, FIXTURE_DATASET, &spec);
        let nodes: Vec<LayoutNode<'_>> = graph
            .nodes
            .iter()
            .map(|n| LayoutNode { id: &n.id })
            .collect();
        let edges: Vec<LayoutEdge<'_>> = graph
            .edges
            .iter()
            .map(|e| LayoutEdge {
                source: &e.source,
                target: &e.target,
            })
            .collect();
        let pos = layout_force(&nodes, &edges, 1280.0, 768.0, 130.0);
        let bad = pos
            .iter()
            .filter(|(_, p)| !p.x.is_finite() || !p.y.is_finite())
            .count();
        let max = pos
            .iter()
            .fold(0.0_f32, |m, (_, p)| m.max(p.x.abs()).max(p.y.abs()));
        assert_eq!(bad, 0, "{name} non-finite {bad} of {} max {max}", pos.len());
        assert!(max < 1.0e6, "{name} positions ran away: {max}");
    }
}

fn view(name: &str) -> BTreeMap<String, Value> {
    let world = coasys_world();
    let shapes = core_shapes();
    let spec = match name {
        "schema" => schema_view(),
        "knowledge" => knowledge_view(),
        "content" => content_view(),
        other => panic!("unknown view {other}"),
    };
    let graph = build(&world, shapes, FIXTURE_DATASET, &spec);
    let mut nodes = BTreeMap::new();
    for node in &graph.nodes {
        let v = serde_json::to_value(node).unwrap();
        nodes.insert(node.id.clone(), v);
    }
    let mut edges = BTreeMap::new();
    for edge in &graph.edges {
        let v = serde_json::to_value(edge).unwrap();
        edges.insert(edge.id.clone(), v);
    }
    let mut out = BTreeMap::new();
    out.insert("nodes".into(), Value::Object(nodes.into_iter().collect()));
    out.insert("edges".into(), Value::Object(edges.into_iter().collect()));
    out
}

fn golden(name: &str) -> (Value, Value) {
    let text = include_str!("../data/coasys-golden.json");
    let file: Value = serde_json::from_str(text).unwrap();
    let nodes = index(file[name]["nodes"].as_array().unwrap(), "id");
    let edges = index(file[name]["edges"].as_array().unwrap(), "id");
    (Value::Object(nodes), Value::Object(edges))
}

fn index(items: &[Value], key: &str) -> serde_json::Map<String, Value> {
    items
        .iter()
        .map(|item| (item[key].as_str().unwrap().to_string(), item.clone()))
        .collect()
}

fn assert_view(name: &str) {
    let got = view(name);
    let (nodes, edges) = golden(name);
    assert_eq!(got["nodes"], nodes, "{name} nodes");
    assert_eq!(got["edges"], edges, "{name} edges");
}

#[test]
fn schema_matches_ts() {
    assert_view("schema");
}

#[test]
fn knowledge_matches_ts() {
    assert_view("knowledge");
}

#[test]
fn content_matches_ts() {
    assert_view("content");
}
