//! Snapshot and store-map loader policy: malformed known tables are
//! rejected naming themselves, unknown fields pass through untouched, and a
//! version the reader does not know is refused rather than misread.
use serde_json::json;
use we_data::{OfflineData, StoreMap};

#[test]
fn malformed_known_tables_are_rejected() {
    for (label, doc) in [
        ("stores as text", json!({ "stores": "not-a-table" })),
        ("stores as a list", json!({ "stores": ["sessionStore"] })),
        ("queries as a list", json!({ "queries": ["calls"] })),
        ("invokes as text", json!({ "invokes": "spaceStore.ping" })),
        (
            "a store that is not an object",
            json!({ "stores": { "s": 7 } }),
        ),
        ("a non-object document", json!(["stores"])),
    ] {
        let err = OfflineData::from_snapshot(&doc, None);
        assert!(err.is_err(), "{label} should fail, not load silently");
    }
}

#[test]
fn unknown_fields_and_extra_metadata_load() {
    // A snapshot C2a may decorate — recordedAt, agent, a routes claim,
    // per-store notes — reads exactly like the undecorated form.
    let doc = json!({
        "recordedAt": "2026-06-01T12:00:00Z",
        "agent": "did:key:z6MkAda",
        "routes": ["/space/demo"],
        "stores": {
            "sessionStore": { "me": { "did": "did:key:z6MkAda" } }
        },
        "queries": { "calls": [] },
        "invokes": { "spaceStore.ping": { "ok": true } }
    });
    OfflineData::from_snapshot(&doc, None).expect("decorated snapshot loads");
}

#[test]
fn unsupported_versions_are_refused() {
    // `version` absent or 1 is the format this reader knows; anything newer
    // refuses rather than half-loading fields it cannot interpret.
    OfflineData::from_snapshot(&json!({ "version": 1, "stores": {} }), None)
        .expect("version 1 loads");
    OfflineData::from_snapshot(&json!({ "stores": {} }), None).expect("no version loads");
    for doc in [
        json!({ "version": 2, "stores": {} }),
        json!({ "version": "one", "stores": {} }),
    ] {
        let err = OfflineData::from_snapshot(&doc, None);
        assert!(err.is_err(), "{doc} should refuse an unsupported version");
    }

    // The store map declares its own version the same way — an omitted
    // version is a pre-version file and stays accepted as 0.
    StoreMap::parse(r#"{"version": 1, "members": {}}"#).expect("map v1 parses");
    StoreMap::parse(r#"{"members": {}}"#).expect("unversioned map parses as 0");
    assert!(StoreMap::parse(r#"{"version": 2, "members": {}}"#).is_err());
}

/// `meta.format` is the C2a recorder's version gate (`we-snapshot@2`); the
/// top-level `version` stays for the older fixtures. A format this reader does
/// not know is refused, and a `@2` document's `routes` must hold route
/// captures — the per-route truth a route loader reads.
#[test]
fn the_snapshot_format_is_gated() {
    let route = json!({
        "path": "/space/demo",
        "members": { "sessionStore": {} },
        "queries": [
            { "name": "calls", "scope": "template.routes[/calls]", "dataset": "demo",
              "request": { "entity": "CollectionBlock" }, "rows": [] },
            { "name": "card", "scope": "template.meta.panels[inspector].node", "dataset": "demo",
              "descriptor": { "limit": 1 }, "skipped": "when" }
        ]
    });
    OfflineData::from_snapshot(
        &json!({ "meta": { "format": "we-snapshot@2" }, "routes": { "index": route } }),
        None,
    )
    .expect("we-snapshot@2 loads");
    for (label, doc) in [
        (
            "an unknown format",
            json!({ "meta": { "format": "we-snapshot@3" } }),
        ),
        (
            "a format that is not text",
            json!({ "meta": { "format": 2 } }),
        ),
        (
            "@2 routes as a list",
            json!({ "meta": { "format": "we-snapshot@2" }, "routes": ["/space/demo"] }),
        ),
        (
            "@2 route members as a list",
            json!({ "meta": { "format": "we-snapshot@2" },
                    "routes": { "index": { "members": [], "queries": [] } } }),
        ),
        (
            "@2 queries as a name map",
            json!({ "meta": { "format": "we-snapshot@2" },
                    "routes": { "index": { "members": {}, "queries": { "calls": [] } } } }),
        ),
        (
            "a capture without a scope",
            json!({ "meta": { "format": "we-snapshot@2" },
                    "routes": { "index": { "members": {}, "queries": [
                        { "name": "calls", "dataset": "demo", "rows": [] }
                    ] } } }),
        ),
        (
            "a capture with two outcomes",
            json!({ "meta": { "format": "we-snapshot@2" },
                    "routes": { "index": { "members": {}, "queries": [
                        { "name": "calls", "scope": "s", "dataset": "demo",
                          "request": { "entity": "X" }, "rows": [], "skipped": "when" }
                    ] } } }),
        ),
        (
            "a capture with no outcome",
            json!({ "meta": { "format": "we-snapshot@2" },
                    "routes": { "index": { "members": {}, "queries": [
                        { "name": "calls", "scope": "s", "dataset": "demo",
                          "request": { "entity": "X" } }
                    ] } } }),
        ),
        (
            "answered rows without the request they answer",
            json!({ "meta": { "format": "we-snapshot@2" },
                    "routes": { "index": { "members": {}, "queries": [
                        { "name": "calls", "scope": "s", "dataset": "demo", "rows": [] }
                    ] } } }),
        ),
    ] {
        assert!(
            OfflineData::from_snapshot(&doc, None).is_err(),
            "{label} should be refused"
        );
    }
}
