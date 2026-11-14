//! `withBoxSidesFilled` and `tierBagOf` — how a state or tier bag that names
//! only *some* sides of a box (padding, margin, radius) takes the rest from
//! what sits beneath it. The box is one CSS declaration, so it falls back as a
//! whole: naming `pt` without the others would send them to `0`, silently
//! discarding the values the element had. Ported from
//! `design-system/utils/src/index.ts`.

use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;

/// A resolved prop bag — `props` themselves or a `hoverProps`/`mdUpProps`
/// object.
pub type Bag = IndexMap<Arc<str>, Value>;

/// The viewport tier — `TIERS` in `1-tokens/src/breakpoint.ts`, ordered by
/// precedence: a tier applies when the width clears its threshold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Tier {
    Base,
    Sm,
    Md,
    Lg,
}

impl Tier {
    /// `sm: 640px, md: 900px, lg: 1200px` — literals baked into the generated
    /// CSS, so baked here too.
    pub fn for_width(px: f32) -> Tier {
        if px >= 1200.0 {
            Tier::Lg
        } else if px >= 900.0 {
            Tier::Md
        } else if px >= 640.0 {
            Tier::Sm
        } else {
            Tier::Base
        }
    }

    /// `sm`–`lg` ascending — `TIERS.slice(1)`.
    pub const UPPER: [Tier; 3] = [Tier::Sm, Tier::Md, Tier::Lg];

    /// The prop key a tier's bag lives under — `TIER_PROP_KEYS`.
    pub fn prop_key(self) -> Option<&'static str> {
        match self {
            Tier::Base => None,
            Tier::Sm => Some("smUpProps"),
            Tier::Md => Some("mdUpProps"),
            Tier::Lg => Some("lgUpProps"),
        }
    }
}

/// `sideOf` — the first truthy value in a side's fallback chain.
fn side_of<'a>(props: Option<&'a Bag>, chain: &[&str]) -> Option<&'a Value> {
    let props = props?;
    for key in chain {
        let v = props.get(*key);
        if let Some(v) = v {
            if v.truthy() {
                return Some(v);
            }
        }
    }
    None
}

/// `BOX_SIDES`: each box's side keys and the prop chain each reads, most
/// specific first — padding, margin, radius.
const BOX_SIDES: [[(&str, [&str; 3]); 4]; 3] = [
    [
        ("pt", ["pt", "py", "p"]),
        ("pr", ["pr", "px", "p"]),
        ("pb", ["pb", "py", "p"]),
        ("pl", ["pl", "px", "p"]),
    ],
    [
        ("mt", ["mt", "my", "m"]),
        ("mr", ["mr", "mx", "m"]),
        ("mb", ["mb", "my", "m"]),
        ("ml", ["ml", "mx", "m"]),
    ],
    [
        ("rtl", ["rtl", "rt", "rl"]),
        ("rtr", ["rtr", "rt", "rr"]),
        ("rbr", ["rbr", "rb", "rr"]),
        ("rbl", ["rbl", "rb", "rl"]),
    ],
];

// Radius chains are four deep — the table above truncates at 3 for a uniform
// array shape; the real chains live here.
const RADIUS_BOX: [(&str, [&str; 4]); 4] = [
    ("rtl", ["rtl", "rt", "rl", "r"]),
    ("rtr", ["rtr", "rt", "rr", "r"]),
    ("rbr", ["rbr", "rb", "rr", "r"]),
    ("rbl", ["rbl", "rb", "rl", "r"]),
];

/// `withBoxSidesFilled` — `below` nearest first. A bag naming some but not all
/// of a box's sides gets the rest filled from `below`; a box it leaves alone
/// or names entirely is kept as written.
pub fn with_box_sides_filled(bag: &Bag, below: &[Option<&Bag>]) -> Bag {
    let mut out: Option<Bag> = None;
    for (box_idx, bx) in BOX_SIDES.iter().enumerate() {
        let named: [Option<Value>; 4] = std::array::from_fn(|i| {
            let (_, chain) = &bx[i];
            // The radius box has a four-key chain; pad/margin chains are 3.
            if box_idx == 2 {
                let (_, rchain) = &RADIUS_BOX[i];
                side_of(Some(bag), rchain).cloned()
            } else {
                side_of(Some(bag), chain).cloned()
            }
        });
        if named.iter().all(Option::is_none) || named.iter().all(Option::is_some) {
            continue;
        }
        let filled = out.get_or_insert_with(|| bag.clone());
        for (_, chain) in bx.iter() {
            for key in chain.iter() {
                filled.shift_remove(*key);
            }
        }
        // The radius box's fourth key (`r`) is not in the 3-wide chains.
        if box_idx == 2 {
            filled.shift_remove("r");
        }
        for (i, (side, chain)) in bx.iter().enumerate() {
            if named[i].is_some() {
                continue;
            }
            let mut resolved: Option<Value> = None;
            for layer in below {
                resolved = if box_idx == 2 {
                    side_of(*layer, &RADIUS_BOX[i].1).cloned()
                } else {
                    side_of(*layer, chain).cloned()
                };
                if resolved.is_some() {
                    break;
                }
            }
            if let Some(v) = resolved {
                filled.insert(Arc::from(*side), v);
            }
        }
    }
    out.unwrap_or_else(|| bag.clone())
}

/// A bag as borrowed from a prop value — only objects count, and an empty one
/// reads as absent (both the TS truthiness gate and `Object.keys` check).
pub(crate) fn bag_of<'a>(props: &'a Bag, key: &str) -> Option<&'a Bag> {
    match props.get(key) {
        Some(Value::Obj(o)) if !o.is_empty() => Some(o.as_ref()),
        _ => None,
    }
}

/// `tierBagOf` — the tier's bag with its box sides filled from the tiers
/// beneath it and then the element's own props. `None` when there is no bag
/// for this tier.
pub fn tier_bag_of(props: &Bag, tier: Tier) -> Option<Bag> {
    let bag = bag_of(props, tier.prop_key()?)?.clone();
    // Tiers strictly below this one, nearest first, then the base props —
    // `TIERS.slice(1, indexOf(tier)).reverse().map(t => props[TIER_PROP_KEYS[t]])`.
    let n = Tier::UPPER
        .iter()
        .position(|t| *t >= tier)
        .unwrap_or(Tier::UPPER.len());
    let mut beneath: Vec<Option<&Bag>> = Tier::UPPER[..n]
        .iter()
        .rev()
        .filter_map(|t| t.prop_key())
        .map(|key| bag_of(props, key))
        .collect();
    beneath.push(Some(props));
    Some(with_box_sides_filled(&bag, &beneath))
}

/// The state-bag equivalent: `withBoxSidesFilled(bag, [props])`.
pub fn state_bag_filled(bag: &Bag, props: &Bag) -> Bag {
    with_box_sides_filled(bag, &[Some(props)])
}
