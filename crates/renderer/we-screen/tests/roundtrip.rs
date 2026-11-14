//! URL round-trip (brief test 3): for a random `Location` built from
//! schema-shaped values, `open(href()).href() == href()` — and the query
//! params keep their order. Native-only: `proptest`'s dep chain does not
//! build for wasm.
#![cfg(not(target_arch = "wasm32"))]

use indexmap::IndexMap;
use proptest::prelude::*;
use we_screen::{Location, MemoryHistory, Navigator, ScreenSchema};

/// Param names like the bundle's — `dna`, `card`, `sel`, `other-param` —
/// and the odd URL-ish char thrown in.
fn name_strategy() -> impl Strategy<Value = String> {
    prop::string::string_regex("[a-z][a-z0-9-]{0,11}")
        .unwrap()
        .prop_filter("non-empty name", |s| !s.is_empty())
}

/// Values like real param values: record ids and `kind|id` refs, so `:`,
/// `/` and `|` all show up.
fn value_strategy() -> impl Strategy<Value = String> {
    prop::string::string_regex("[a-zA-Z0-9:|/. -]{1,24}").unwrap()
}

fn segment_strategy() -> impl Strategy<Value = String> {
    prop::string::string_regex("[a-z][a-z0-9-]{0,11}")
        .unwrap()
        .prop_filter("non-empty segment", |s| !s.is_empty())
}

fn location_strategy() -> impl Strategy<Value = Location> {
    (
        prop::collection::vec(segment_strategy(), 1..4),
        prop::collection::vec((name_strategy(), value_strategy()), 0..6),
    )
        .prop_map(|(segments, pairs)| {
            let mut params = IndexMap::new();
            for (k, v) in pairs {
                params.insert(k, v);
            }
            Location {
                pathname: format!("/{}", segments.join("/")),
                segments,
                params,
                fragment: None,
            }
        })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn open_href_roundtrips(location in location_strategy()) {
        let href = location.href();
        let mut nav = Navigator::new(
            ScreenSchema::default(),
            Box::new(MemoryHistory::new("/")),
        );
        nav.open(&href);
        prop_assert_eq!(nav.href(), href.as_str(), "href did not round-trip");
        // …and the params kept their order.
        let keys: Vec<&String> = nav.location().params.keys().collect();
        prop_assert_eq!(
            keys,
            location.params.keys().collect::<Vec<&String>>(),
            "param order did not round-trip"
        );
    }
}
