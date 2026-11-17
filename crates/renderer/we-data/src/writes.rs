//! The write planner (E11): a store map's `modelWrite` row plus an
//! `$invoke`'s arguments become the [`Write`]s a host sends.
//!
//! A row is data (`we-ad4m/data/storemap-writes.json` for now): every field
//! of a write is an expression evaluated with `args` — the call's arguments
//! — and two functions ported from the TS stores, `fieldValue`
//! (`RecordStore.updateRecordField`'s coercion) and `signalTypeFields`
//! (`SpaceStore.createSignalType`'s normalising). Pure: no executor, no
//! I/O, wasm-safe.
//!
//! A row's fields:
//! - `writes`: `[{ op, class, id?, properties? | property + value, skipIf? }]`
//!   — `op` is a literal (`create`, `update`, `remove`), the rest are
//!   expressions. A write whose `skipIf` is truthy is left out.
//! - `dataset`: an expression; anything but `undefined`/`null` is refused
//!   (writes to another dataset are not wired yet).
//! - `confirm`: `{ title, body }`, expressions — the host asks first.
//! - `fail`: the first sentence of the notice a refused write shows.
use std::collections::BTreeMap;
use std::sync::Arc;

use indexmap::IndexMap;
use serde_json::{json, Value as Json};
use we_expr::{eval, parse, Expr, MapEnv, Value};

use crate::{MemberKind, MemberRow, StoreMap, Write, WriteOp};

/// What the host must do for one `modelWrite` call.
#[derive(Debug, Clone, PartialEq)]
pub struct WritePlan {
    /// In order. Empty: nothing to send, answer `undefined` (a `skipIf`).
    pub writes: Vec<Write>,
    /// Ask the person first (a destructive row).
    pub confirm: Option<Confirm>,
    /// The notice's first sentence when the executor refuses.
    pub fail: String,
}

/// A confirmation's words.
#[derive(Debug, Clone, PartialEq)]
pub struct Confirm {
    pub title: String,
    pub body: String,
}

/// What the planner reads besides the arguments.
pub struct PlanCx<'a> {
    /// `recordStore.displays`, for `fieldValue`'s kind lookup. `Undefined` when absent.
    pub displays: &'a Value,
}

/// The rows the planner runs: `kind: modelWrite` rows of a store map, by
/// `$invoke` target.
#[derive(Debug, Clone, Default)]
pub struct WriteRows {
    rows: BTreeMap<String, MemberRow>,
}

/// The key [`WriteRows::from_map`] stores a row's own target under, so
/// [`plan`]'s errors can name it.
const TARGET: &str = "$target";

/// The notice's first sentence for a row without `fail`.
pub const DEFAULT_FAIL: &str = "Could not do that.";

impl WriteRows {
    /// Keeps `kind == modelWrite` rows only.
    pub fn from_map(map: &StoreMap) -> WriteRows {
        let rows = map
            .members
            .iter()
            .filter(|(_, row)| row.kind == MemberKind::ModelWrite)
            .map(|(target, row)| {
                let mut row = row.clone();
                row.raw.insert(TARGET.into(), Json::String(target.clone()));
                (target.clone(), row)
            })
            .collect();
        WriteRows { rows }
    }

    pub fn get(&self, target: &str) -> Option<&MemberRow> {
        self.rows.get(target)
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &MemberRow)> {
        self.rows.iter().map(|(k, v)| (k.as_str(), v))
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }
}

/// One parsed write recipe.
struct Recipe {
    op: WriteOp,
    class: Expr,
    id: Option<Expr>,
    properties: Option<Expr>,
    property: Option<Expr>,
    value: Option<Expr>,
    skip_if: Option<Expr>,
}

/// Plan one call of `row` with `args`. An `Err` is a sentence for the
/// notice: a malformed row (naming the target and field), a refused
/// dataset, or a write with no class or id.
pub fn plan(row: &MemberRow, args: &[Value], cx: &PlanCx) -> Result<WritePlan, String> {
    let target = row.raw.get(TARGET).and_then(Json::as_str).unwrap_or("?");
    let expr = |field: &str, source: &Json| -> Result<Expr, String> {
        let text = source
            .as_str()
            .ok_or_else(|| format!("{target} {field}: not an expression string"))?;
        parse(text).map_err(|e| format!("{target} {field}: syntax error: {e}"))
    };
    let optional =
        |field: &str, w: &serde_json::Map<String, Json>| -> Result<Option<Expr>, String> {
            w.get(field).map(|s| expr(field, s)).transpose()
        };

    // Parse everything first, so a typo in a row is found whatever the
    // arguments (`every_shipped_row_parses`).
    let dataset = row
        .raw
        .get("dataset")
        .map(|s| expr("dataset", s))
        .transpose()?;
    let confirm = match row.raw.get("confirm") {
        None => None,
        Some(Json::Object(c)) => Some((
            expr("confirm.title", c.get("title").unwrap_or(&Json::Null))?,
            expr("confirm.body", c.get("body").unwrap_or(&Json::Null))?,
        )),
        Some(_) => return Err(format!("{target} confirm: not an object")),
    };
    let mut recipes = Vec::new();
    for w in row
        .raw
        .get("writes")
        .and_then(Json::as_array)
        .ok_or_else(|| format!("{target} writes: missing"))?
    {
        let w = w
            .as_object()
            .ok_or_else(|| format!("{target} writes: not an object"))?;
        let op = match w.get("op").and_then(Json::as_str) {
            Some("create") => WriteOp::Create,
            Some("update") => WriteOp::Update,
            Some("remove") => WriteOp::Remove,
            other => return Err(format!("{target} op: unknown {other:?}")),
        };
        recipes.push(Recipe {
            op,
            class: expr("class", w.get("class").unwrap_or(&Json::Null))?,
            id: optional("id", w)?,
            properties: optional("properties", w)?,
            property: optional("property", w)?,
            value: optional("value", w)?,
            skip_if: optional("skipIf", w)?,
        });
    }
    let fail = row
        .raw
        .get("fail")
        .and_then(Json::as_str)
        .unwrap_or(DEFAULT_FAIL)
        .to_string();

    let env = env(args, cx);
    if let Some(dataset) = &dataset {
        if !matches!(eval(dataset, &env), Value::Undefined | Value::Null) {
            return Err("writes to another dataset are not wired yet".into());
        }
    }
    let mut writes = Vec::new();
    for r in &recipes {
        if r.skip_if.as_ref().is_some_and(|s| eval(s, &env).truthy()) {
            continue;
        }
        let class =
            non_empty(eval(&r.class, &env)).ok_or_else(|| format!("{target}: missing class"))?;
        let mut body = json!({ "className": class });
        if r.op != WriteOp::Create {
            let id =
                r.id.as_ref()
                    .and_then(|id| non_empty(eval(id, &env)))
                    .ok_or_else(|| format!("{target}: missing id"))?;
            body["baseUri"] = Json::String(id);
        }
        if r.op != WriteOp::Remove {
            if let Some(props) = properties(r, &env, target)? {
                body["properties"] = props;
            } else if r.op == WriteOp::Update {
                return Err(format!("{target}: missing properties"));
            }
        }
        writes.push(Write { op: r.op, body });
    }
    let confirm = match confirm {
        None => None,
        Some((title, body)) => match (eval(&title, &env), eval(&body, &env)) {
            (Value::Str(title), Value::Str(body)) => Some(Confirm {
                title: title.to_string(),
                body: body.to_string(),
            }),
            _ => return Err(format!("{target} confirm: title and body must be text")),
        },
    };
    Ok(WritePlan {
        writes,
        confirm,
        fail,
    })
}

/// A non-empty string, or nothing.
fn non_empty(v: Value) -> Option<String> {
    match v {
        Value::Str(s) if !s.is_empty() => Some(s.to_string()),
        _ => None,
    }
}

/// The write's `properties` object as the RPC takes it. `properties` must
/// evaluate to an object; its `undefined` and `null` fields are left out,
/// as JSON leaves out `undefined` (`Value::to_json` would write
/// `undefined` as a `{"$undefined": true}` marker, which the executor
/// would store, so it is dropped before converting). The single-field form,
/// `property` + `value`, is `{ <property>: value }`.
fn properties(r: &Recipe, env: &MapEnv, target: &str) -> Result<Option<Json>, String> {
    if let Some(p) = &r.properties {
        return match eval(p, env) {
            Value::Obj(o) => Ok(Some(Json::Object(
                o.iter()
                    .filter(|(_, v)| !matches!(v, Value::Undefined | Value::Null))
                    .map(|(k, v)| (k.to_string(), v.to_json()))
                    .collect(),
            ))),
            Value::Undefined if r.op == WriteOp::Create => Ok(None),
            other => Err(format!("{target}: properties is not an object ({other:?})")),
        };
    }
    if let (Some(name), Some(value)) = (&r.property, &r.value) {
        let name =
            non_empty(eval(name, env)).ok_or_else(|| format!("{target}: missing property"))?;
        let mut map = serde_json::Map::new();
        map.insert(name, eval(value, env).to_json());
        return Ok(Some(Json::Object(map)));
    }
    Ok(None)
}

/// `args` and the planner's two functions.
fn env(args: &[Value], cx: &PlanCx) -> MapEnv {
    let displays = cx.displays.clone();
    MapEnv::new()
        .with_root("args", Value::List(Arc::new(args.to_vec())))
        .with_function("fieldValue", move |a: &[Value]| {
            field_value(&displays, arg(a, 0), arg(a, 1), arg(a, 2))
        })
        .with_function("signalTypeFields", |a: &[Value]| {
            signal_type_fields(arg(a, 0))
        })
}

fn arg(a: &[Value], i: usize) -> &Value {
    a.get(i).unwrap_or(&Value::Undefined)
}

/// A key of an object or a store namespace; `Undefined` for anything else.
fn get(v: &Value, key: &str) -> Value {
    match v {
        Value::Obj(o) => o.get(key).cloned().unwrap_or(Value::Undefined),
        Value::Namespace(ns) => ns.get(key),
        _ => Value::Undefined,
    }
}

/// `RecordStore.updateRecordField`'s coercion (`RecordStore.tsx:2866–2874`):
/// unwrap a control's `{ detail }`, then make the value what the field's
/// declared kind says. `Undefined` means "do not write" — the row's
/// `skipIf` tests for it.
fn field_value(displays: &Value, entity: &Value, field: &Value, raw: &Value) -> Value {
    let raw = match raw {
        Value::Obj(o) if o.contains_key("detail") => o["detail"].clone(),
        other => other.clone(),
    };
    let fields = get(&get(displays, &entity.to_text()), "fields");
    let kind = match &fields {
        Value::List(l) => l
            .iter()
            .find(|f| get(f, "name").strict_eq(field))
            .map(|f| get(f, "kind")),
        _ => None,
    };
    let kind = kind.as_ref().map(|k| k.to_text());
    match kind.as_deref() {
        Some("number") => match &raw {
            Value::Undefined | Value::Null => Value::Undefined,
            Value::Str(s) if s.is_empty() => Value::Undefined,
            // `Number(raw)`; `NaN` is not written.
            other => match other.js_number() {
                n if n.is_nan() => Value::Undefined,
                n => Value::Num(n),
            },
        },
        Some("boolean") => Value::Bool(raw.truthy()),
        _ => match &raw {
            // An object is kept as JSON rather than "[object Object]".
            Value::Obj(_) | Value::List(_) => Value::Str(
                serde_json::to_string(&raw.to_json())
                    .unwrap_or_default()
                    .into(),
            ),
            Value::Num(_) | Value::Bool(_) => Value::Str(raw.js_string().into()),
            other => other.clone(),
        },
    }
}

/// `deriveSlug` (`app-shell/src/shared/utils.ts:36`): lower-case, drop
/// everything but `[a-z0-9\s-]`, trim, whitespace runs to `-`.
fn derive_slug(name: &str) -> String {
    let kept: String = name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c.is_whitespace() || *c == '-')
        .collect();
    let trimmed = kept.trim();
    let mut slug = String::with_capacity(trimmed.len());
    let mut in_space = false;
    for c in trimmed.chars() {
        if c.is_whitespace() {
            if !in_space {
                slug.push('-');
            }
            in_space = true;
        } else {
            slug.push(c);
            in_space = false;
        }
    }
    slug
}

/// `SpaceStore.createSignalType`'s normalising (`SpaceStore.tsx:2902`): a
/// slug from the name when none is given, the mode's aggregate when none is
/// given, and the fixed range of a toggle or a vote. Keys keep the order
/// the form gave; new ones are appended.
fn signal_type_fields(config: &Value) -> Value {
    let Value::Obj(config) = config else {
        return Value::Undefined;
    };
    let mut out: IndexMap<Arc<str>, Value> = config.as_ref().clone();
    let field = |k: &str| config.get(k).cloned().unwrap_or(Value::Undefined);
    let name = field("name");
    let slug = match field("slug") {
        s if s.truthy() => s,
        _ if name.truthy() => Value::Str(derive_slug(&name.to_text()).into()),
        _ => Value::Str("".into()),
    };
    out.insert("slug".into(), slug);
    let mode = field("mode");
    if !field("aggregate").truthy() && mode.truthy() {
        let aggregate = match mode.to_text().as_ref() {
            "toggle" => Value::Str("count".into()),
            "vote" => Value::Str("sum".into()),
            "rating" | "slider" => Value::Str("mean".into()),
            _ => Value::Undefined,
        };
        out.insert("aggregate".into(), aggregate);
    }
    let range = match mode.to_text().as_ref() {
        "toggle" => Some((0.0, 1.0)),
        "vote" => Some((-1.0, 1.0)),
        _ => None,
    };
    if let Some((min, max)) = range {
        out.insert("rangeMin".into(), Value::Num(min));
        out.insert("rangeMax".into(), Value::Num(max));
    }
    Value::Obj(Arc::new(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_slug_matches_the_ts() {
        assert_eq!(derive_slug("Up Vote!"), "up-vote");
        assert_eq!(derive_slug(" Up "), "up");
        assert_eq!(derive_slug("a  -  b"), "a---b");
        assert_eq!(derive_slug("Déjà vu"), "dj-vu");
    }
}
