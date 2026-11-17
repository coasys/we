//! The write planner (E11): a `modelWrite` row plus an `$invoke`'s
//! arguments become the writes the host sends, the confirmation it asks
//! first, and the notice it shows when the executor refuses.
use serde_json::json;
use we_data::writes::{plan, PlanCx, WritePlan, WriteRows};
use we_data::{StoreMap, Write, WriteOp};
use we_expr::Value;

const ROWS: &str = include_str!("../../we-ad4m/data/storemap-writes.json");
const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");

fn rows() -> WriteRows {
    WriteRows::from_map(&StoreMap::parse(ROWS).expect("the shipped rows parse"))
}

/// `recordStore.displays` as the recording has it.
fn displays() -> Value {
    let snap: serde_json::Value = serde_json::from_str(SNAPSHOT).unwrap();
    Value::from_json(&snap["stores"]["recordStore"]["displays"])
}

fn args(json: serde_json::Value) -> Vec<Value> {
    match Value::from_json(&json) {
        Value::List(l) => l.as_ref().clone(),
        other => panic!("not a list: {other:?}"),
    }
}

fn run(target: &str, a: serde_json::Value) -> Result<WritePlan, String> {
    let d = displays();
    let rows = rows();
    let row = rows
        .get(target)
        .unwrap_or_else(|| panic!("no row {target}"));
    plan(row, &args(a), &PlanCx { displays: &d })
}

fn one(plan: &WritePlan) -> &Write {
    assert_eq!(plan.writes.len(), 1, "{plan:?}");
    &plan.writes[0]
}

#[test]
fn every_shipped_row_parses() {
    let rows = rows();
    let d = Value::Undefined;
    let cx = PlanCx { displays: &d };
    let mut seen = 0;
    for (target, row) in rows.iter() {
        seen += 1;
        if let Err(e) = plan(row, &[], &cx) {
            assert!(!e.contains("syntax"), "{target}: {e}");
        }
    }
    assert_eq!(seen, 5, "the five E11 rows");
}

#[test]
fn record_delete_plans_one_remove_and_a_confirmation() {
    let p = run(
        "record.delete",
        json!(["CollectionBlock", "e7test://call/1"]),
    )
    .unwrap();
    let w = one(&p);
    assert_eq!(w.op, WriteOp::Remove);
    assert_eq!(
        w.body,
        json!({ "className": "CollectionBlock", "baseUri": "e7test://call/1" })
    );
    let c = p.confirm.as_ref().expect("a destructive row asks first");
    assert_eq!(c.title, "Delete this CollectionBlock?");
    assert_eq!(
        c.body,
        "It will be removed for everyone in this space. This cannot be undone."
    );
    assert_eq!(p.fail, "Could not delete that.");
}

#[test]
fn update_record_field_unwraps_detail_and_coerces_by_kind() {
    let target = "recordStore.updateRecordField";
    let p = run(
        target,
        json!(["TaskBlock", "t1", "title", { "detail": "New" }]),
    )
    .unwrap();
    let w = one(&p);
    assert_eq!(w.op, WriteOp::Update);
    assert_eq!(
        w.body,
        json!({ "className": "TaskBlock", "baseUri": "t1", "properties": { "title": "New" } })
    );
    assert!(p.confirm.is_none());

    let p = run(
        target,
        json!(["SignalType", "s1", "rangeMax", { "detail": "5" }]),
    )
    .unwrap();
    assert_eq!(one(&p).body["properties"], json!({ "rangeMax": 5 }));

    let p = run(
        target,
        json!(["SignalType", "s1", "rangeMax", { "detail": "" }]),
    )
    .unwrap();
    assert!(p.writes.is_empty(), "an empty number is not sent: {p:?}");

    let p = run(
        target,
        json!(["CollectionBlock", "c1", "title", { "detail": { "a": 1 } }]),
    )
    .unwrap();
    assert_eq!(one(&p).body["properties"], json!({ "title": "{\"a\":1}" }));

    let p = run(
        target,
        json!(["SignalType", "s1", "retired", { "detail": 0 }]),
    )
    .unwrap();
    assert_eq!(one(&p).body["properties"], json!({ "retired": false }));

    let p = run(target, json!(["TaskBlock", "t1", "title", 3])).unwrap();
    assert_eq!(one(&p).body["properties"], json!({ "title": "3" }));

    let p = run(target, json!(["", "c1", "title", "x"])).unwrap();
    assert!(p.writes.is_empty(), "no entity: {p:?}");
}

#[test]
fn create_signal_type_derives_slug_aggregate_and_range() {
    let fresh = json!({
        "name": "Up Vote!", "slug": "", "description": "", "icon": "❤️", "iconSecondary": "",
        "mode": "toggle", "rangeMin": 0, "rangeMax": 1, "step": 1
    });
    let p = run("spaceStore.createSignalType", json!([fresh])).unwrap();
    let w = one(&p);
    assert_eq!(w.op, WriteOp::Create);
    assert_eq!(w.body["className"], "SignalType");
    let props = &w.body["properties"];
    assert_eq!(props["slug"], "up-vote");
    assert_eq!(props["aggregate"], "count");
    assert_eq!(props["rangeMin"], 0);
    assert_eq!(props["rangeMax"], 1);
    for key in [
        "name",
        "description",
        "icon",
        "iconSecondary",
        "mode",
        "step",
    ] {
        assert_eq!(props[key], fresh[key], "{key} kept");
    }
    // The order the form gave, new keys after it.
    let keys: Vec<&str> = props
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "name",
            "slug",
            "description",
            "icon",
            "iconSecondary",
            "mode",
            "rangeMin",
            "rangeMax",
            "step",
            "aggregate"
        ]
    );

    let vote = json!({ "name": "Agree", "slug": "", "mode": "vote", "rangeMin": 0, "rangeMax": 5 });
    let p = run("spaceStore.createSignalType", json!([vote])).unwrap();
    let props = &one(&p).body["properties"];
    assert_eq!(props["aggregate"], "sum");
    assert_eq!(props["rangeMin"], -1);
    assert_eq!(props["rangeMax"], 1);
    assert_eq!(props["slug"], "agree");

    // A name with outer spaces: the slug is trimmed before the dashes.
    let p = run("spaceStore.createSignalType", json!([{ "name": " Up " }])).unwrap();
    assert_eq!(one(&p).body["properties"]["slug"], "up");

    // A slug given is kept; an aggregate given is kept.
    let p = run(
        "spaceStore.createSignalType",
        json!([{ "name": "Star", "slug": "fav", "mode": "rating", "aggregate": "median" }]),
    )
    .unwrap();
    let props = &one(&p).body["properties"];
    assert_eq!(props["slug"], "fav");
    assert_eq!(props["aggregate"], "median");
}

#[test]
fn record_create_and_update_send_their_fields() {
    let p = run(
        "record.create",
        json!(["TaskBlock", { "title": "T", "gone": null }]),
    )
    .unwrap();
    assert_eq!(
        one(&p).body,
        json!({ "className": "TaskBlock", "properties": { "title": "T" } })
    );
    let p = run(
        "record.update",
        json!(["TaskBlock", "t1", { "status": "done" }]),
    )
    .unwrap();
    assert_eq!(
        one(&p).body,
        json!({ "className": "TaskBlock", "baseUri": "t1", "properties": { "status": "done" } })
    );
    let e = run(
        "record.update",
        json!(["TaskBlock", "", { "status": "done" }]),
    )
    .unwrap_err();
    assert!(e.contains("missing"), "{e}");
}

#[test]
fn another_dataset_is_refused() {
    let e = run(
        "record.create",
        json!(["AgentSettings", {}, { "dataset": "datasetStore.rootDataset" }]),
    )
    .unwrap_err();
    assert!(e.contains("another dataset"), "{e}");
}

#[test]
fn a_syntax_error_names_the_row_and_field() {
    let map = StoreMap::parse(
        r#"{ "version": 1, "members": { "x.y": { "kind": "modelWrite",
            "writes": [{ "op": "remove", "class": "args[0", "id": "args[1]" }] } } }"#,
    )
    .unwrap();
    let rows = WriteRows::from_map(&map);
    let d = Value::Undefined;
    let e = plan(rows.get("x.y").unwrap(), &[], &PlanCx { displays: &d }).unwrap_err();
    assert!(e.starts_with("x.y class: "), "{e}");
}
