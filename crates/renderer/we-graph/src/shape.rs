//! Entity shapes the graph reads. The JSON is `toEntityShape(manifestEntries(CORE_MANIFEST))`
//! for the assembled core vocabulary (WeNode relations merged, `display.title` as
//! `nameProperty`). Community shapes are not in the coasys fixture.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Shape {
    pub name: String,
    #[serde(rename = "nameProperty", default)]
    pub name_property: Option<String>,
    #[serde(default)]
    pub properties: Vec<Prop>,
    #[serde(default)]
    pub relations: Vec<Rel>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Prop {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Rel {
    pub name: String,
    #[serde(default)]
    pub target: String,
    pub cardinality: String,
}

impl Shape {
    pub fn relation(&self, name: &str) -> Option<&Rel> {
        self.relations.iter().find(|r| r.name == name)
    }
}

/// The core shapes, in manifest order.
pub fn core_shapes() -> &'static [Shape] {
    static SHAPES: std::sync::OnceLock<Vec<Shape>> = std::sync::OnceLock::new();
    SHAPES
        .get_or_init(|| {
            serde_json::from_str(include_str!("../data/core-shapes.json"))
                .expect("core-shapes.json")
        })
        .as_slice()
}

pub fn shape_named<'a>(shapes: &'a [Shape], name: &str) -> Option<&'a Shape> {
    shapes.iter().find(|s| s.name == name)
}
