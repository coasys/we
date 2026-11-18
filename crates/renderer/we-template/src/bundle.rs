//! [`Bundle`]: an app as data — what a deployment ships in its seed or a
//! person installs from a file. Mirrors `Bundle` in
//! `packages/schema-system/shared/src/bundle.ts`, and like it brings no code:
//! a bundle names modules, it cannot ship one.
//!
//! Every type here records its authored key order ([`crate::order`]) — an
//! interleaved key a struct does not name writes back where the author put
//! it, not flattened to the end.
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::node::{JsonMap, SchemaNode};
use crate::order::{
    field, json, ordered_object, push, push_required, required, rest_of, serialize_ordered,
};

pub const BUNDLE_FORMAT: &str = "we-bundle";
pub const BUNDLE_FORMAT_VERSION: u64 = 1;

/// The file. Every key the format names is a typed field; anything else lands
/// in [`Bundle::extra`] so a newer file still round-trips.
#[derive(Debug, Clone)]
pub struct Bundle {
    /// `BUNDLE_FORMAT`; checked before anything else.
    pub format: String,
    /// Renamed at serde: `formatVersion` on the wire.
    pub format_version: u64,
    /// Stable and lowercase — what an install is recognised by.
    pub id: String,
    /// The bundle's own version.
    pub version: String,
    /// The name the app goes by — the window title among other places.
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    /// Who says they made it. A claim; a file attests nothing.
    pub author: Option<BundleAuthor>,
    /// The chrome around every space: a template with `meta.role: "app"`.
    pub app: Option<BundleTemplate>,
    /// Space templates (no role) and sections (`meta.role: "view"`).
    pub templates: Option<Vec<BundleTemplate>>,
    /// Pages of the app's own (`meta.role: "page"`).
    pub pages: Option<Vec<BundleTemplate>>,
    /// One theme, when `themes` is not used instead.
    pub theme: Option<BundleTheme>,
    /// The themes the app offers, its default first.
    pub themes: Option<Vec<BundleTheme>>,
    /// Renamed at serde: `recordTypes` on the wire.
    pub record_types: Option<Vec<BundleRecordType>>,
    pub display: Option<BundleDisplay>,
    /// The app's name, mark and About page.
    pub brand: Option<BundleBrand>,
    /// The sign-in screen, in place of the host's. See `protected-pieces.md`.
    /// Renamed at serde: `bootScreen` on the wire.
    pub boot_screen: Option<SchemaNode>,
    /// What a space made in this app can start with. Kept raw for now — the
    /// renderer does not create spaces (the `SpaceStarter` shape lives in
    /// `spaceStarter.ts`).
    pub starters: Option<Vec<serde_json::Value>>,
    /// Keys this format does not name, kept verbatim.
    pub extra: JsonMap,
    /// Authored key order — [`SchemaNode::key_order`](crate::SchemaNode).
    #[doc(hidden)]
    pub key_order: Vec<String>,
}

const BUNDLE_FIELDS: &[&str] = &[
    "format",
    "formatVersion",
    "id",
    "version",
    "name",
    "description",
    "icon",
    "author",
    "app",
    "templates",
    "pages",
    "theme",
    "themes",
    "recordTypes",
    "display",
    "brand",
    "bootScreen",
    "starters",
];

impl Bundle {
    pub fn parse(text: &str) -> Result<Bundle, serde_json::Error> {
        serde_json::from_str(text)
    }

    /// Whether the header is one this build can read — the check the TS
    /// `readBundle` runs first. Structural validation beyond it is the host's.
    pub fn is_supported(&self) -> bool {
        self.format == BUNDLE_FORMAT && self.format_version == BUNDLE_FORMAT_VERSION
    }
}

impl Serialize for Bundle {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut named = Vec::with_capacity(BUNDLE_FIELDS.len());
        push_required(&mut named, "format", &self.format);
        push_required(&mut named, "formatVersion", &self.format_version);
        push_required(&mut named, "id", &self.id);
        push_required(&mut named, "version", &self.version);
        push_required(&mut named, "name", &self.name);
        push(&mut named, "description", &self.description);
        push(&mut named, "icon", &self.icon);
        push(&mut named, "author", &self.author);
        push(&mut named, "app", &self.app);
        push(&mut named, "templates", &self.templates);
        push(&mut named, "pages", &self.pages);
        push(&mut named, "theme", &self.theme);
        push(&mut named, "themes", &self.themes);
        push(&mut named, "recordTypes", &self.record_types);
        push(&mut named, "display", &self.display);
        push(&mut named, "brand", &self.brand);
        push(&mut named, "bootScreen", &self.boot_screen);
        push(&mut named, "starters", &self.starters);
        serialize_ordered(&self.key_order, named, &self.extra, serializer)
    }
}

impl<'de> Deserialize<'de> for Bundle {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let (key_order, map) = ordered_object(deserializer)?;
        Ok(Bundle {
            format: required::<D, _>(&map, "format")?,
            format_version: required::<D, _>(&map, "formatVersion")?,
            id: required::<D, _>(&map, "id")?,
            version: required::<D, _>(&map, "version")?,
            name: required::<D, _>(&map, "name")?,
            description: field::<D, _>(&map, "description")?,
            icon: field::<D, _>(&map, "icon")?,
            author: field::<D, _>(&map, "author")?,
            app: field::<D, _>(&map, "app")?,
            templates: field::<D, _>(&map, "templates")?,
            pages: field::<D, _>(&map, "pages")?,
            theme: field::<D, _>(&map, "theme")?,
            themes: field::<D, _>(&map, "themes")?,
            record_types: field::<D, _>(&map, "recordTypes")?,
            display: field::<D, _>(&map, "display")?,
            brand: field::<D, _>(&map, "brand")?,
            boot_screen: field::<D, _>(&map, "bootScreen")?,
            starters: field::<D, _>(&map, "starters")?,
            extra: rest_of(&map, BUNDLE_FIELDS),
            key_order,
        })
    }
}

/// Who says they made the bundle.
#[derive(Debug, Clone)]
pub struct BundleAuthor {
    pub name: Option<String>,
    pub did: Option<String>,
    pub extra: JsonMap,
    /// Authored key order — [`SchemaNode::key_order`](crate::SchemaNode).
    #[doc(hidden)]
    pub key_order: Vec<String>,
}

const AUTHOR_FIELDS: &[&str] = &["name", "did"];

impl Serialize for BundleAuthor {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut named = Vec::with_capacity(AUTHOR_FIELDS.len());
        push(&mut named, "name", &self.name);
        push(&mut named, "did", &self.did);
        serialize_ordered(&self.key_order, named, &self.extra, serializer)
    }
}

impl<'de> Deserialize<'de> for BundleAuthor {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let (key_order, map) = ordered_object(deserializer)?;
        Ok(BundleAuthor {
            name: field::<D, _>(&map, "name")?,
            did: field::<D, _>(&map, "did")?,
            extra: rest_of(&map, AUTHOR_FIELDS),
            key_order,
        })
    }
}

/// A template shipped in the bundle — `TemplateSchema & { id: string }`:
/// a [`SchemaNode`] plus its id and `meta`. Template-level keys the node does
/// not name (`author`, `source`, `templateVersion`, `schemaVersion`,
/// `_fromSpace`, `meta`'s siblings) land in the node's `extra`.
#[derive(Debug, Clone)]
pub struct BundleTemplate {
    pub id: String,
    pub meta: serde_json::Value,
    /// The template's node body — everything `id`/`meta` is not.
    pub node: SchemaNode,
    /// Authored key order — [`SchemaNode::key_order`](crate::SchemaNode).
    #[doc(hidden)]
    pub key_order: Vec<String>,
}

const TEMPLATE_FIELDS: &[&str] = &["id", "meta"];

impl Serialize for BundleTemplate {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut named = Vec::with_capacity(TEMPLATE_FIELDS.len());
        push_required(&mut named, "id", &self.id);
        push_required(&mut named, "meta", &self.meta);
        let serde_json::Value::Object(node) = json(&self.node) else {
            unreachable!("a node serializes to an object");
        };
        serialize_ordered(&self.key_order, named, &node, serializer)
    }
}

impl<'de> Deserialize<'de> for BundleTemplate {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let (key_order, map) = ordered_object(deserializer)?;
        let node =
            SchemaNode::deserialize(serde_json::Value::Object(rest_of(&map, TEMPLATE_FIELDS)))
                .map_err(serde::de::Error::custom)?;
        Ok(BundleTemplate {
            id: required::<D, _>(&map, "id")?,
            meta: required::<D, _>(&map, "meta")?,
            node,
            key_order,
        })
    }
}

/// A bundle's theme: the parameter object a theme is, plus optional CSS.
#[derive(Debug, Clone)]
pub struct BundleTheme {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub overrides: serde_json::Value,
    pub css: Option<String>,
    pub extra: JsonMap,
    /// Authored key order — [`SchemaNode::key_order`](crate::SchemaNode).
    #[doc(hidden)]
    pub key_order: Vec<String>,
}

const THEME_FIELDS: &[&str] = &["id", "name", "icon", "overrides", "css"];

impl Serialize for BundleTheme {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut named = Vec::with_capacity(THEME_FIELDS.len());
        push_required(&mut named, "id", &self.id);
        push_required(&mut named, "name", &self.name);
        push(&mut named, "icon", &self.icon);
        push_required(&mut named, "overrides", &self.overrides);
        push(&mut named, "css", &self.css);
        serialize_ordered(&self.key_order, named, &self.extra, serializer)
    }
}

impl<'de> Deserialize<'de> for BundleTheme {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let (key_order, map) = ordered_object(deserializer)?;
        Ok(BundleTheme {
            id: required::<D, _>(&map, "id")?,
            name: required::<D, _>(&map, "name")?,
            icon: field::<D, _>(&map, "icon")?,
            overrides: required::<D, _>(&map, "overrides")?,
            css: field::<D, _>(&map, "css")?,
            extra: rest_of(&map, THEME_FIELDS),
            key_order,
        })
    }
}

/// A kind of record the app is about, as the model wizard would save it.
/// `manifest` is the neutral entity manifest, kept raw.
#[derive(Debug, Clone)]
pub struct BundleRecordType {
    pub name: String,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub manifest: serde_json::Value,
    pub extra: JsonMap,
    /// Authored key order — [`SchemaNode::key_order`](crate::SchemaNode).
    #[doc(hidden)]
    pub key_order: Vec<String>,
}

const RECORD_TYPE_FIELDS: &[&str] = &["name", "icon", "description", "manifest"];

impl Serialize for BundleRecordType {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut named = Vec::with_capacity(RECORD_TYPE_FIELDS.len());
        push_required(&mut named, "name", &self.name);
        push(&mut named, "icon", &self.icon);
        push(&mut named, "description", &self.description);
        push_required(&mut named, "manifest", &self.manifest);
        serialize_ordered(&self.key_order, named, &self.extra, serializer)
    }
}

impl<'de> Deserialize<'de> for BundleRecordType {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let (key_order, map) = ordered_object(deserializer)?;
        Ok(BundleRecordType {
            name: required::<D, _>(&map, "name")?,
            icon: field::<D, _>(&map, "icon")?,
            description: field::<D, _>(&map, "description")?,
            manifest: required::<D, _>(&map, "manifest")?,
            extra: rest_of(&map, RECORD_TYPE_FIELDS),
            key_order,
        })
    }
}

/// How spaces are shown in the app.
#[derive(Debug, Clone)]
pub struct BundleDisplay {
    pub spaces: DisplaySpaces,
    /// The bundle's space template meant by `ours`, by its id in the bundle.
    pub template: Option<String>,
    pub extra: JsonMap,
    /// Authored key order — [`SchemaNode::key_order`](crate::SchemaNode).
    #[doc(hidden)]
    pub key_order: Vec<String>,
}

const DISPLAY_FIELDS: &[&str] = &["spaces", "template"];

impl Serialize for BundleDisplay {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut named = Vec::with_capacity(DISPLAY_FIELDS.len());
        push_required(&mut named, "spaces", &self.spaces);
        push(&mut named, "template", &self.template);
        serialize_ordered(&self.key_order, named, &self.extra, serializer)
    }
}

impl<'de> Deserialize<'de> for BundleDisplay {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let (key_order, map) = ordered_object(deserializer)?;
        Ok(BundleDisplay {
            spaces: required::<D, _>(&map, "spaces")?,
            template: field::<D, _>(&map, "template")?,
            extra: rest_of(&map, DISPLAY_FIELDS),
            key_order,
        })
    }
}

/// `ours` — the bundle's space template renders every space; `theirs` — each
/// space keeps the template it chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DisplaySpaces {
    Ours,
    Theirs,
}

/// What makes one app look like another: name, mark, wordmark, About page.
/// `mark`/`wordmark` are SVG source, drawn as images.
#[derive(Debug, Clone)]
pub struct BundleBrand {
    pub name: String,
    pub mark: Option<String>,
    pub wordmark: Option<String>,
    /// What the About page says, as Markdown.
    pub about: Option<String>,
    /// The bundle's own About page id, winning over `about` when both exist.
    /// Renamed at serde: `aboutPage` on the wire.
    pub about_page: Option<String>,
    pub extra: JsonMap,
    /// Authored key order — [`SchemaNode::key_order`](crate::SchemaNode).
    #[doc(hidden)]
    pub key_order: Vec<String>,
}

const BRAND_FIELDS: &[&str] = &["name", "mark", "wordmark", "about", "aboutPage"];

impl Serialize for BundleBrand {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut named = Vec::with_capacity(BRAND_FIELDS.len());
        push_required(&mut named, "name", &self.name);
        push(&mut named, "mark", &self.mark);
        push(&mut named, "wordmark", &self.wordmark);
        push(&mut named, "about", &self.about);
        push(&mut named, "aboutPage", &self.about_page);
        serialize_ordered(&self.key_order, named, &self.extra, serializer)
    }
}

impl<'de> Deserialize<'de> for BundleBrand {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let (key_order, map) = ordered_object(deserializer)?;
        Ok(BundleBrand {
            name: required::<D, _>(&map, "name")?,
            mark: field::<D, _>(&map, "mark")?,
            wordmark: field::<D, _>(&map, "wordmark")?,
            about: field::<D, _>(&map, "about")?,
            about_page: field::<D, _>(&map, "aboutPage")?,
            extra: rest_of(&map, BRAND_FIELDS),
            key_order,
        })
    }
}
