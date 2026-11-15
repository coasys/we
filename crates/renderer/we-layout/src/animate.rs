//! CSS transitions, run by the engine: a `transition: width 250ms
//! ease-in-out` on a node makes a change to its computed `width` play out
//! over 250 ms instead of jumping — the rail widening under the pointer.
//!
//! [`Transitions`] holds what is in flight between frames. Each frame the
//! frontend hands it the resolved tree and the time; it reads every node's
//! computed style (memoised, so this is a lookup), starts a track where a
//! transitioned property's computed value moved since the last frame, and
//! answers with the tree to lay out and paint: the same tree with each
//! animated property's value at this instant written into the node's
//! `styles` hatch — the declarations a style resolves last — so layout,
//! measure and paint see an ordinary node at an in-between size.
//!
//! The rules are CSS's, for the properties animated here (`width`,
//! `height` and `opacity`, the ones WE's templates transition):
//!
//! - a node's first frame does not transition — nothing changed;
//! - a change mid-flight starts the new track from the value on screen;
//! - the duration, delay and easing are the new style's;
//! - a value that cannot be interpolated as a length (`auto`, a percent,
//!   a `calc()`) jumps;
//! - with reduced motion asked for, everything jumps.
use std::collections::HashMap;
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_style::{ease, Easing, Style};
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::defaults::{style_of, unit_metrics, StyleCx};

/// A property this module animates, as CSS names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Prop {
    Width,
    Height,
    Opacity,
}

impl Prop {
    const ALL: [Prop; 3] = [Prop::Width, Prop::Height, Prop::Opacity];

    fn css(self) -> &'static str {
        match self {
            Prop::Width => "width",
            Prop::Height => "height",
            Prop::Opacity => "opacity",
        }
    }

    /// The computed value, as a number this module can interpolate: px
    /// for a length, `0..1` for opacity. `None` for anything else.
    fn value(self, style: &Style, scx: &StyleCx) -> Option<f32> {
        let dim = match self {
            Prop::Width => style.layout.width.as_ref(),
            Prop::Height => style.layout.height.as_ref(),
            Prop::Opacity => return Some(style.paint.opacity.unwrap_or(1.0)),
        }?;
        if matches!(dim, we_style::Dimension::Percent(_)) {
            return None;
        }
        dim.to_px(&unit_metrics(scx), scx.viewport)
    }

    /// The declaration that draws `v`.
    fn decl(self, v: f32) -> Value {
        match self {
            Prop::Opacity => Value::Num(v as f64),
            _ => Value::from(format!("{v}px").as_str()),
        }
    }
}

/// One property of one node playing out.
#[derive(Debug, Clone)]
struct Track {
    from: f32,
    to: f32,
    /// When it starts moving, after any delay — seconds on the frame clock.
    start: f64,
    duration: f64,
    easing: Easing,
}

impl Track {
    fn at(&self, now: f64) -> f32 {
        let t = if self.duration <= 0.0 {
            1.0
        } else {
            ((now - self.start) / self.duration).clamp(0.0, 1.0) as f32
        };
        self.from + (self.to - self.from) * ease(&self.easing, t)
    }

    fn done(&self, now: f64) -> bool {
        now >= self.start + self.duration
    }
}

/// What a transitioned property was last frame: the computed value the
/// style asked for, and the track drawing it, if one is running.
#[derive(Debug, Clone)]
struct Slot {
    target: f32,
    track: Option<Track>,
}

/// The transitions in flight across frames — one per frontend, kept with
/// the layout it feeds.
#[derive(Debug, Default)]
pub struct Transitions {
    slots: HashMap<(NodeId, Prop), Slot>,
}

impl Transitions {
    /// The tree to lay out and paint at `now` (seconds, the frontend's
    /// frame clock): `None` when no property is mid-transition, so the
    /// resolved tree is drawn as it is and nothing is copied.
    pub fn apply(
        &mut self,
        root: &ResolvedNode,
        scx: &StyleCx,
        now: f64,
        reduced_motion: bool,
    ) -> Option<ResolvedNode> {
        let mut seen = std::collections::HashSet::new();
        let mut shown: HashMap<NodeId, Vec<(Prop, f32)>> = HashMap::new();
        self.walk(root, scx, now, reduced_motion, &mut seen, &mut shown);
        // A node that left the tree takes its tracks with it.
        self.slots.retain(|key, _| seen.contains(key));
        if shown.is_empty() {
            return None;
        }
        let mut out = root.clone();
        rewrite(&mut out, &shown);
        Some(out)
    }

    /// Whether any track is still moving at `now` — a frontend keeps
    /// drawing frames until it is not.
    pub fn running(&self, now: f64) -> bool {
        self.slots
            .values()
            .any(|s| s.track.as_ref().is_some_and(|t| !t.done(now)))
    }

    fn walk(
        &mut self,
        node: &ResolvedNode,
        scx: &StyleCx,
        now: f64,
        reduced: bool,
        seen: &mut std::collections::HashSet<(NodeId, Prop)>,
        shown: &mut HashMap<NodeId, Vec<(Prop, f32)>>,
    ) {
        let style = style_of(node, scx);
        for t in &style.transitions {
            for prop in Prop::ALL {
                if t.property.as_ref() != prop.css() && t.property.as_ref() != "all" {
                    continue;
                }
                let key = (node.id.clone(), prop);
                if !seen.insert(key.clone()) {
                    continue;
                }
                let Some(target) = prop.value(&style, scx) else {
                    // Nothing to interpolate: it jumps, and a track
                    // running toward an older value stops.
                    self.slots.remove(&key);
                    continue;
                };
                let duration = t.duration_ms.unwrap_or(0.0) as f64 / 1000.0;
                let delay = t.delay_ms.unwrap_or(0.0) as f64 / 1000.0;
                let slot = self.slots.entry(key).or_insert(Slot {
                    target,
                    track: None,
                });
                if (slot.target - target).abs() > f32::EPSILON {
                    let from = slot
                        .track
                        .as_ref()
                        .map_or(slot.target, |track| track.at(now));
                    slot.target = target;
                    slot.track = (!reduced && duration > 0.0).then(|| Track {
                        from,
                        to: target,
                        start: now + delay,
                        duration,
                        easing: t.easing.clone(),
                    });
                }
                if let Some(track) = &slot.track {
                    if track.done(now) {
                        slot.track = None;
                    } else {
                        shown
                            .entry(node.id.clone())
                            .or_default()
                            .push((prop, track.at(now)));
                    }
                }
            }
        }
        let child_scx = StyleCx {
            scope: &style.scope,
            ..*scx
        };
        for child in &node.children {
            if let ResolvedChild::Node(n) = child {
                self.walk(n, &child_scx, now, reduced, seen, shown);
            }
        }
    }
}

/// Write each animated value into its node's `styles` hatch, over what
/// the hatch already held.
fn rewrite(node: &mut ResolvedNode, shown: &HashMap<NodeId, Vec<(Prop, f32)>>) {
    if let Some(values) = shown.get(&node.id) {
        let mut styles: IndexMap<Arc<str>, Value> = match node.props.get("styles") {
            Some(Value::Obj(o)) => (**o).clone(),
            _ => IndexMap::new(),
        };
        for (prop, v) in values {
            styles.insert(Arc::from(prop.css()), prop.decl(*v));
        }
        node.props
            .insert(Arc::from("styles"), Value::Obj(Arc::new(styles)));
    }
    for child in &mut node.children {
        if let ResolvedChild::Node(n) = child {
            rewrite(n, shown);
        }
    }
}
