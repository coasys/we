//! Fix-round gates for the drawn world and the query seed.
//!
//! An included child past the class preload must stay a node. A query
//! with no limit stops at 100. An empty scope anchor loads nothing.
//! Unsupported query keys do not run the class. Force above 512 nodes
//! uses one grid pass.

use we_graph::{
    build, content_view, core_shapes, entity_address, shape_named, view_from_json, Expansion,
    LayoutNode, Record, SeedSpec, ViewSpec, World,
};

fn text_rows(n: usize) -> Vec<Record> {
    let shapes = core_shapes();
    let shape = shape_named(shapes, "TextBlock");
    (0..n)
        .map(|i| {
            Record::from_instance(
                "TextBlock",
                &serde_json::json!({ "id": format!("t{i}"), "name": format!("row {i}"), "text": format!("row {i}") }),
                shape,
            )
            .expect("text row")
        })
        .collect()
}

#[test]
fn included_child_past_the_preload_keeps_its_node_and_contains_edge() {
    let shapes = core_shapes();
    let collection = shape_named(shapes, "CollectionBlock");
    let mut records = text_rows(200);
    let row = serde_json::json!({
        "id": "col",
        "title": "Late bin",
        "children": [{
            "id": "t200",
            "__subjectClass": "TextBlock",
            "name": "late-child",
            "text": "late-child"
        }]
    });
    records.push(Record::from_instance("CollectionBlock", &row, collection).expect("collection"));
    let world = World::from_records(records);
    let graph = build(&world, shapes, "space-cap", &content_view());
    let child_id = entity_address("space-cap", "TextBlock", "t200");
    let child = graph.nodes.iter().find(|n| n.id == child_id);
    assert!(
        child.is_some(),
        "included child t200 is outside the 200-row preload and must still be a node"
    );
    assert_eq!(child.unwrap().label, "late-child");
    let text = child
        .unwrap()
        .data
        .as_ref()
        .and_then(|d| d.get("text"))
        .and_then(|v| v.as_str());
    assert_eq!(text, Some("late-child"));
    let parent_id = entity_address("space-cap", "CollectionBlock", "col");
    assert!(
        graph
            .edges
            .iter()
            .any(|e| { e.ty == "contains" && e.source == parent_id && e.target == child_id }),
        "the contains edge from the collection to t200 must be drawn"
    );
}

#[test]
fn typed_include_keeps_its_label() {
    let shapes = core_shapes();
    let collection = shape_named(shapes, "CollectionBlock");
    let row = serde_json::json!({
        "id": "parent",
        "title": "Parent",
        "board": { "id": "board-1", "title": "Board title" }
    });
    let record = Record::from_instance("CollectionBlock", &row, collection).expect("parent");
    let world = World::from_records(vec![record]);
    let spec = ViewSpec {
        seeds: vec![SeedSpec::Query {
            entity: "CollectionBlock".into(),
            limit: 10,
        }],
        expansion: Expansion {
            default_depth: 1,
            direction: "out",
            limit: Some(20),
            max_nodes: Some(500),
            expanders: Some(vec!["entity".into()]),
        },
    };
    let graph = build(&world, shapes, "typed", &spec);
    let id = entity_address("typed", "CollectionBlock", "board-1");
    let label = graph
        .nodes
        .iter()
        .find(|n| n.id == id)
        .map(|n| n.label.as_str())
        .unwrap_or("");
    assert_eq!(label, "Board title");
}

#[test]
fn query_seed_without_a_limit_stops_at_100() {
    let shapes = core_shapes();
    let world = World::from_records(text_rows(150));
    let spec = view_from_json(
        &serde_json::json!({ "source": "query", "options": { "entity": "TextBlock" } }),
        &serde_json::json!({ "defaultDepth": 0 }),
    )
    .expect("a bare query is a view");
    let SeedSpec::Query { limit, .. } = &spec.seeds[0] else {
        panic!("query seed");
    };
    assert_eq!(*limit, 100, "a query seed with no limit stops at 100");
    let graph = build(&world, shapes, "cap", &spec);
    assert_eq!(graph.nodes.len(), 100);
}

#[test]
fn empty_scope_anchor_loads_no_rows() {
    let shapes = core_shapes();
    let world = World::from_records(text_rows(5));
    let spec = view_from_json(
        &serde_json::json!({
            "source": "query",
            "options": { "entity": "TextBlock", "scope": {} }
        }),
        &serde_json::json!({ "defaultDepth": 0 }),
    )
    .expect("an empty scope is a view that loads nothing");
    let graph = build(&world, shapes, "scope", &spec);
    assert_eq!(
        graph.nodes.len(),
        0,
        "an empty scope anchor must load no rows"
    );
}

#[test]
fn unsupported_query_options_do_not_run_the_class() {
    let rejected = [
        serde_json::json!({ "entity": "TextBlock", "where": { "id": "x" } }),
        serde_json::json!({ "entity": "TextBlock", "order": ["id"] }),
        serde_json::json!({ "entity": "TextBlock", "relations": ["children"] }),
        serde_json::json!({ "entity": "TextBlock", "dataset": "other" }),
        serde_json::json!({ "entity": "TextBlock", "reified": {} }),
        serde_json::json!({ "entity": "TextBlock", "scope": { "anchorId": "root" } }),
    ];
    for options in rejected {
        let spec = view_from_json(
            &serde_json::json!({ "source": "query", "options": options }),
            &serde_json::json!({}),
        );
        assert!(
            spec.is_none(),
            "unsupported query options must not run the class"
        );
    }
}

#[test]
fn force_past_the_pair_cap_uses_a_grid() {
    let ids: Vec<String> = (0..513).map(|i| format!("n{i}")).collect();
    let nodes: Vec<LayoutNode<'_>> = ids.iter().map(|id| LayoutNode { id }).collect();
    let pos = we_graph::layout_force(&nodes, &[], 900.0, 600.0, 130.0);
    assert_eq!(pos.len(), 513);
    for (_, point) in &pos {
        assert!(point.x.is_finite() && point.y.is_finite());
    }
    let cols = (513_f32).sqrt().ceil() as usize;
    let cell_w = 900.0 / cols as f32;
    assert!(
        (pos[0].1.x - 0.5 * cell_w).abs() < 0.05,
        "a graph past the pair cap must use the grid, got {:?}",
        pos[0].1
    );
}
