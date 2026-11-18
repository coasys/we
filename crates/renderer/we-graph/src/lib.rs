//! The read-only graph of a space.
//!
//! Addresses, seeds and expanders follow `packages/graph-system`. The three
//! views are the ones `GraphView/index.ts` declares: schema, knowledge, content.
//! Canvas is a fourth mode (the stored arrangement). It is not built here.
#![forbid(unsafe_code)]

mod address;
mod engine;
mod layout;
mod shape;
mod world;

pub use address::{entity_address, literal_address, parse_address, property_address, SCHEMA_TYPE};
pub use engine::{
    build, content_view, knowledge_view, schema_view, view_from_json, Edge, Expansion, Graph, Node,
    SeedSpec, ViewSpec,
};
pub use layout::{force as layout_force, tree as layout_tree, LayoutEdge, LayoutNode, Point};
pub use shape::{core_shapes, shape_named, Prop, Rel, Shape};
pub use world::{Include, Query, Record, World};

/// Dataset id of `fixtures/coasys` (`preview-coasys`).
pub const FIXTURE_DATASET: &str = "preview-coasys";

/// The coasys fixture as a queryable world.
pub fn coasys_world() -> World {
    World::coasys_fixture()
}
