//! `ScreenSchema` — the screen's declared params, as data (screen-state.md
//! §4.3). A bundle cannot name Rust types, so the params are declared in JSON
//! (`meta.screen.params`, or the store map's `screen` block) and the engine
//! enforces them: a declared param that fails to parse reads as absent; an
//! undeclared one stays a plain string.
use indexmap::IndexMap;

/// The declared params of a screen, plus the page ids its `Route` reading
/// recognises.
#[derive(Clone, Debug, Default)]
pub struct ScreenSchema {
    /// Param name → its declaration, in authored order.
    pub params: IndexMap<String, ParamDecl>,
    /// The bundle's `pages[]` segments — what `Route::Page` matches.
    pub pages: Vec<String>,
}

/// One declared param: its type, and the flags the declaration carries.
#[derive(Clone, Debug, Default)]
pub struct ParamDecl {
    /// How the raw string parses for typed accessors.
    pub ty: ParamType,
    /// `identity: true` — feeds `page_identity()` instead of the `id` default.
    pub identity: bool,
    /// The default `push` when a write does not say (`set_param`'s declared
    /// default, screen-state.md §4.3).
    pub push: bool,
}

/// What a declared param parses as for typed accessors (`nav.param_typed`).
/// String-shaped types (`string`, `id`, `did`, `entity`) read as text; a type
/// the declaration invented reads as text too, so a foreign bundle keeps
/// working.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum ParamType {
    /// Free text.
    #[default]
    Text,
    /// A record id / URI (`id`, `card`, `channel`).
    Id,
    /// An agent DID.
    Did,
    /// An entity name (`cardType`).
    Entity,
    /// Presence flag (`new`): `0`/`false` is false, anything else true.
    Flag,
    /// `true`/`false` only (`tree`).
    Boolean,
    /// One of the declared values.
    Enum(Vec<String>),
    /// `kind` or `kind<id>` — e.g. `dna`, `separator: "|"`, with `also` for
    /// kind-only extras like `all`.
    Ref {
        /// The separator between parts.
        separator: String,
        /// Part names, in order (`["kind","id"]`).
        parts: Vec<String>,
        /// Extra values that are a kind on their own (`["all"]`).
        also: Vec<String>,
    },
    /// A type the schema named that this build does not know — reads as text.
    Other(String),
}

/// A declared param's typed value — for Rust callers only; the template keeps
/// reading strings.
#[derive(Clone, Debug, PartialEq)]
pub enum ParamValue {
    /// Text, as stored.
    Str(String),
    /// A `boolean` or `flag` read.
    Bool(bool),
    /// A `ref` read: `kind` always, `id` when the second part is present.
    Ref { kind: String, id: Option<String> },
}

impl ParamType {
    /// Parse the raw param text; `Err(())` reads as absent to the caller.
    fn parse(&self, raw: &str) -> Result<ParamValue, ()> {
        match self {
            ParamType::Text
            | ParamType::Id
            | ParamType::Did
            | ParamType::Entity
            | ParamType::Other(_) => Ok(ParamValue::Str(raw.to_string())),
            ParamType::Flag => Ok(ParamValue::Bool(raw != "0" && raw != "false")),
            ParamType::Boolean => match raw {
                "true" => Ok(ParamValue::Bool(true)),
                "false" => Ok(ParamValue::Bool(false)),
                _ => Err(()),
            },
            ParamType::Enum(values) if values.iter().any(|v| v == raw) => {
                Ok(ParamValue::Str(raw.to_string()))
            }
            ParamType::Enum(_) => Err(()),
            ParamType::Ref {
                separator, also, ..
            } => {
                let parts: Vec<&str> = raw.split(separator.as_str()).collect();
                match parts.as_slice() {
                    [kind] if !kind.is_empty() => Ok(ParamValue::Ref {
                        kind: kind.to_string(),
                        id: None,
                    }),
                    // `also` names read as the same one-part shape; a
                    // three-or-more-part value is not a ref at all.
                    [kind, id] if !kind.is_empty() || also.iter().any(|a| a == kind) => {
                        Ok(ParamValue::Ref {
                            kind: kind.to_string(),
                            id: Some(id.to_string()),
                        })
                    }
                    _ => Err(()),
                }
            }
        }
    }
}

impl ParamDecl {
    /// Parse `raw` against this declaration; `None` reads as absent.
    pub fn parse(&self, raw: &str) -> Option<ParamValue> {
        self.ty.parse(raw).ok()
    }
}

impl ScreenSchema {
    /// From `{ params: { name: { type, identity?, push?, … } }, pages? }` —
    /// the store-map `screen` block, or a bundle's `meta.screen`. Unknown
    /// fields are ignored; an unknown `type` becomes `Other` and still reads.
    pub fn from_json(json: &serde_json::Value) -> ScreenSchema {
        let mut schema = ScreenSchema::default();
        if let Some(params) = json["params"].as_object() {
            for (name, decl) in params {
                schema.params.insert(name.clone(), param_decl(decl));
            }
        }
        if let Some(pages) = json["pages"].as_array() {
            schema.pages = pages
                .iter()
                .filter_map(|p| p.as_str().map(str::to_string))
                .collect();
        }
        schema
    }

    /// The param `page_identity()` reads — the one declared `identity`, or
    /// `id`, which is what `RouteStore.page` hard-codes.
    pub fn identity_param(&self) -> &str {
        self.params
            .iter()
            .find(|(_, d)| d.identity)
            .map(|(name, _)| name.as_str())
            .unwrap_or("id")
    }

    /// The declared `push` default for `set_param` when the caller passes no
    /// explicit answer.
    pub fn declared_push(&self, name: &str) -> bool {
        self.params.get(name).map(|d| d.push).unwrap_or(false)
    }

    /// The declaration for `name`, if one exists.
    pub fn param(&self, name: &str) -> Option<&ParamDecl> {
        self.params.get(name)
    }
}

fn param_decl(json: &serde_json::Value) -> ParamDecl {
    let ty = match json["type"].as_str().unwrap_or("string") {
        "string" => ParamType::Text,
        "id" => ParamType::Id,
        "did" => ParamType::Did,
        "entity" => ParamType::Entity,
        "flag" => ParamType::Flag,
        "boolean" => ParamType::Boolean,
        "enum" => ParamType::Enum(strings(&json["values"])),
        "ref" => ParamType::Ref {
            separator: json["separator"].as_str().unwrap_or("|").to_string(),
            parts: strings(&json["parts"]),
            also: strings(&json["also"]),
        },
        other => ParamType::Other(other.to_string()),
    };
    ParamDecl {
        ty,
        identity: json["identity"].as_bool().unwrap_or(false),
        push: json["push"].as_bool().unwrap_or(false),
    }
}

fn strings(json: &serde_json::Value) -> Vec<String> {
    json.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}
