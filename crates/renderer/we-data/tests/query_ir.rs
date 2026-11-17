//! The query IR's wire names: a filter travels under `where` — `where_`
//! is only the Rust-legal field name — and survives a JSON round trip.
use serde_json::json;
use we_data::QueryIr;

#[test]
fn where_survives_round_trip() {
    let query = QueryIr {
        where_: Some(json!({"author": {"$eq": "did:agent:alice"}})),
        order: Some(json!({"title": "asc"})),
        limit: Some(20),
        ..QueryIr::default()
    };

    let wire = serde_json::to_value(&query).unwrap();
    assert_eq!(wire["where"], json!({"author": {"$eq": "did:agent:alice"}}));
    assert!(
        wire.get("where_").is_none(),
        "where_ must not leak to the wire — the executor would drop the filter"
    );

    let back: QueryIr = serde_json::from_value(wire).unwrap();
    assert_eq!(back.where_, query.where_);
    assert_eq!(back.order, query.order);
    assert_eq!(back.limit, Some(20));
}

/// The TS document shape — `{"where": …, "limit": …}` — parses into `where_`.
#[test]
fn where_reads_from_ts_shape() {
    let back: QueryIr = serde_json::from_value(json!({
        "where": {"author": "did:agent:alice"},
        "limit": 5
    }))
    .unwrap();
    assert_eq!(back.where_, Some(json!({"author": "did:agent:alice"})));
    assert_eq!(back.limit, Some(5));
    assert!(back.order.is_none());
}
