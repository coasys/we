//! [`Bundle`]: an app as data — what a deployment ships in its seed or a
//! person installs from a file. Mirrors `Bundle` in
//! `packages/schema-system/shared/src/bundle.ts`, and like it brings no code:
//! a bundle names modules, it cannot ship one.
use serde::{Deserialize, Serialize};

use crate::node::{JsonMap, SchemaNode};

pub const BUNDLE_FORMAT: &str = "we-bundle";
pub const BUNDLE_FORMAT_VERSION: u64 = 1;

/// The file. Every key the format names is a typed field; anything else lands
/// in [`Bundle::extra`] so a newer file still round-trips.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bundle {
    /// `BUNDLE_FORMAT`; checked before anything else.
    pub format: String,
    #[serde(rename = "formatVersion")]
    pub format_version: u64,
    /// Stable and lowercase — what an install is recognised by.
    pub id: String,
    /// The bundle's own version.
    pub version: String,
    /// The name the app goes by — the window title among other places.
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Who says they made it. A claim; a file attests nothing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<BundleAuthor>,
    /// The chrome around every space: a template with `meta.role: "app"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<BundleTemplate>,
    /// Space templates (no role) and sections (`meta.role: "view"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub templates: Option<Vec<BundleTemplate>>,
    /// Pages of the app's own (`meta.role: "page"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<Vec<BundleTemplate>>,
    /// One theme, when `themes` is not used instead.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<BundleTheme>,
    /// The themes the app offers, its default first.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub themes: Option<Vec<BundleTheme>>,
    #[serde(rename = "recordTypes", skip_serializing_if = "Option::is_none")]
    pub record_types: Option<Vec<BundleRecordType>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<BundleDisplay>,
    /// The app's name, mark and About page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand: Option<BundleBrand>,
    /// The sign-in screen, in place of the host's. See `protected-pieces.md`.
    #[serde(rename = "bootScreen", skip_serializing_if = "Option::is_none")]
    pub boot_screen: Option<SchemaNode>,
    /// What a space made in this app can start with. Kept raw for now — the
    /// renderer does not create spaces (the `SpaceStarter` shape lives in
    /// `spaceStarter.ts`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starters: Option<Vec<serde_json::Value>>,
    /// Keys this format does not name, kept verbatim.
    #[serde(flatten)]
    pub extra: JsonMap,
}

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

/// Who says they made the bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleAuthor {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub did: Option<String>,
    #[serde(flatten)]
    pub extra: JsonMap,
}

/// A template shipped in the bundle — `TemplateSchema & { id: string }`:
/// a [`SchemaNode`] plus its id and `meta`. Template-level keys the node does
/// not name (`author`, `source`, `templateVersion`, `schemaVersion`,
/// `_fromSpace`, `meta`'s siblings) land in the node's `extra`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleTemplate {
    pub id: String,
    pub meta: serde_json::Value,
    #[serde(flatten)]
    pub node: SchemaNode,
}

/// A bundle's theme: the parameter object a theme is, plus optional CSS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleTheme {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub overrides: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css: Option<String>,
    #[serde(flatten)]
    pub extra: JsonMap,
}

/// A kind of record the app is about, as the model wizard would save it.
/// `manifest` is the neutral entity manifest, kept raw.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleRecordType {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub manifest: serde_json::Value,
    #[serde(flatten)]
    pub extra: JsonMap,
}

/// How spaces are shown in the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleDisplay {
    pub spaces: DisplaySpaces,
    /// The bundle's space template meant by `ours`, by its id in the bundle.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(flatten)]
    pub extra: JsonMap,
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleBrand {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mark: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wordmark: Option<String>,
    /// What the About page says, as Markdown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
    /// The bundle's own About page id, winning over `about` when both exist.
    #[serde(rename = "aboutPage", skip_serializing_if = "Option::is_none")]
    pub about_page: Option<String>,
    #[serde(flatten)]
    pub extra: JsonMap,
}
