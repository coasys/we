//! A tier bag naming some sides of a box keeps them and fills the rest from
//! beneath (`withBoxSidesFilled`, 2-design-system/utils). Glow parity: the
//! About hero is `pt: 110px` with `mdUpProps: { pt: 124px, pb: 70px }`;
//! Rust dropped the two sides the tier named and kept only the filled
//! ones, so at the md tier the hero lost its top padding and sat under the
//! header bar.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_metrics::SizeTier as Tier;
use we_style::{tier_bag_of, Bag};

fn bag(pairs: &[(&str, Value)]) -> Bag {
    pairs
        .iter()
        .map(|(k, v)| (Arc::from(*k), v.clone()))
        .collect::<IndexMap<Arc<str>, Value>>()
}

#[test]
fn a_tier_keeps_the_sides_it_names() {
    let md = bag(&[("pt", Value::from("124px")), ("pb", Value::from("70px"))]);
    let props = bag(&[
        ("px", Value::from("22px")),
        ("pt", Value::from("110px")),
        ("mdUpProps", Value::from(md)),
    ]);
    let t = tier_bag_of(&props, Tier::Md).expect("md bag");
    let get = |k: &str| t.get(k).map(|v| v.js_string());
    assert_eq!(get("pt").as_deref(), Some("124px"), "{t:?}");
    assert_eq!(get("pb").as_deref(), Some("70px"), "{t:?}");
    assert_eq!(get("pl").as_deref(), Some("22px"), "{t:?}");
    assert_eq!(get("pr").as_deref(), Some("22px"), "{t:?}");
}
