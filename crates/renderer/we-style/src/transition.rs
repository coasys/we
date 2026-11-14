//! `transition`: the parsed `transition` declaration — what the emitted
//! `opacity var(--we-transition-200) ease-out` becomes once `var()`s resolve.
//! Animation itself is E8's; this is the data.

use std::sync::Arc;

use crate::css_value::{split_top_commas, top_level_parts};

/// One `transition` shorthand entry.
#[derive(Debug, Clone, PartialEq)]
pub struct Transition {
    /// The property name as written (`opacity`, `all`, `width`).
    pub property: Arc<str>,
    /// Duration in ms — `None` when it names a `--we-transition-*` variable
    /// this theme does not declare.
    pub duration_ms: Option<f32>,
    /// Delay in ms, when a second duration follows the first.
    pub delay_ms: Option<f32>,
    pub easing: Easing,
}

/// `ease`, `ease-in-out`, `cubic-bezier(…)` and friends.
#[derive(Debug, Clone, PartialEq)]
pub enum Easing {
    Ease,
    EaseIn,
    EaseOut,
    EaseInOut,
    Linear,
    Bezier(f32, f32, f32, f32),
    StepStart,
    StepEnd,
    /// A `steps(…)` or anything else, kept as text.
    Other(Arc<str>),
}

/// Parse the whole `transition` value (post-substitution): comma-separated
/// entries, each `property duration? easing? delay?` in any order CSS allows.
pub fn parse_transitions(text: &str) -> Vec<Transition> {
    let mut out = Vec::new();
    for part in split_top_commas(text) {
        if part.is_empty() {
            continue;
        }
        let mut property: Option<Arc<str>> = None;
        let mut durations: Vec<Option<f32>> = Vec::new();
        let mut easing: Option<Easing> = None;
        for seg in top_level_parts(part) {
            let lower = seg.to_ascii_lowercase();
            if lower.starts_with("var(--we-easing") || lower.starts_with("var(--we-ease") {
                easing = Some(Easing::Other(Arc::from(seg)));
            } else if let Some(d) = parse_duration(seg) {
                durations.push(Some(d));
            } else if lower.starts_with("var(") {
                // A duration variable the theme does not declare — most often
                // `var(--we-transition-*)`.
                durations.push(None);
            } else if let Some(e) = parse_easing(seg) {
                easing = Some(e);
            } else if property.is_none() {
                property = Some(Arc::from(seg));
            } else {
                durations.push(None);
            }
        }
        let property = match property {
            Some(p) => p,
            None => continue,
        };
        out.push(Transition {
            property,
            duration_ms: durations.first().copied().flatten(),
            delay_ms: durations.get(1).copied().flatten(),
            easing: easing.unwrap_or(Easing::Ease),
        });
    }
    out
}

/// `250ms`, `0.2s` — in ms. `var(--we-transition-*)` left undeclared is `None`
/// at the call site (it is not a duration literal).
fn parse_duration(seg: &str) -> Option<f32> {
    if let Some(ms) = seg.strip_suffix("ms") {
        return ms.parse::<f32>().ok();
    }
    if let Some(s) = seg.strip_suffix('s') {
        return s.parse::<f32>().ok().map(|v| v * 1000.0);
    }
    None
}

fn parse_easing(seg: &str) -> Option<Easing> {
    let lower = seg.to_ascii_lowercase();
    Some(match lower.as_str() {
        "ease" => Easing::Ease,
        "ease-in" => Easing::EaseIn,
        "ease-out" => Easing::EaseOut,
        "ease-in-out" => Easing::EaseInOut,
        "linear" => Easing::Linear,
        "step-start" => Easing::StepStart,
        "step-end" => Easing::StepEnd,
        _ => {
            if let Some(inner) = lower
                .strip_prefix("cubic-bezier(")
                .and_then(|s| s.strip_suffix(')'))
            {
                let n: Vec<f32> = inner
                    .split(',')
                    .filter_map(|p| p.trim().parse().ok())
                    .collect();
                if n.len() == 4 {
                    return Some(Easing::Bezier(n[0], n[1], n[2], n[3]));
                }
            }
            if lower.starts_with("steps(") {
                return Some(Easing::Other(Arc::from(seg)));
            }
            return None;
        }
    })
}
