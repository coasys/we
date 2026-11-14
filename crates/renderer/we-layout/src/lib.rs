//! `we-layout`: frontend-independent layout over a resolved tree.
//!
//! The taffy tree, style resolution ([`defaults`]) and the flat [`Layout`]
//! live here; how a leaf or a text run measures goes through [`Measure`],
//! which the frontend implements in its own unit (egui: px, a terminal
//! frontend: cells). The content-box rules are layout's own: taffy hands
//! measurement a border-box `known` and a content-box `available_space`, so
//! [`Measure::measure`] answers at the content box and padding/border land
//! outside.
#![forbid(unsafe_code)]

pub mod defaults;
mod geom;
pub mod props;
mod tree;

pub use geom::{Pos2, Rect, Size, Vec2};
pub use tree::{
    layout, Direction, Layout, Measure, PartSpec, Parts, PartsSpec, Pick, TextSpan, TreeCfg,
};
