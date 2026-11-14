//! [`Value`]: every value a template expression can hold.
//!
//! JSON round-trips go through [`Value::to_json`]/[`Value::from_json`], which
//! carry the markers the shared conformance vectors use for the values
//! plain JSON cannot hold (`packages/schema-system/conformance`, task C1 —
//! `src/encode.ts`):
//!
//! | marker                      | decodes to                          |
//! |-----------------------------|-------------------------------------|
//! | `{"$undefined":true}`       | [`Value::Undefined`]                |
//! | `{"$nan":true}`             | [`Value::Num(NAN)`]                 |
//! | `{"$number":"-0"}`          | [`Value::Num(-0.0)`]                |
//! | `{"$number":"±Infinity"}`   | [`Value::Num(±INFINITY)`]           |
//! | `{"$namespace":{…}}`        | [`Value::Namespace`] over a map     |
//! | `{"$namespace":true}`       | an opaque namespace (no members)    |
//! | `{"$callable":"…"}`         | [`Value::Callable`] of that name    |
//! | `{"$localMetaEntry":true,…}`| a field's `{touched, errors}` meta  |
use std::fmt;
use std::sync::Arc;

use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Property names no expression may read, whatever the data
/// (`expressions/ast.ts` — `DENIED_PROPERTIES`).
pub const DENIED_PROPERTIES: [&str; 3] = ["__proto__", "constructor", "prototype"];

/// A lazily read bag of named values — a store, `local`, a callback payload.
///
/// ```
/// use std::sync::Arc;
/// use we_expr::{MapNamespace, Namespace, Value};
///
/// // A namespace is read through `get`; an unknown key is `Undefined`.
/// let ns = MapNamespace::new([("title".into(), "hello".into())].into_iter().collect());
/// assert!(ns.get("title").strict_eq(&Value::from("hello")));
/// assert!(ns.get("missing").is_undefined());
/// assert_eq!(ns.keys().len(), 1);
///
/// // In a value position it settles to `Undefined` — a store is not a value.
/// let v = Value::namespace(ns);
/// assert!(v.settle().is_undefined());
/// ```
pub trait Namespace: Send + Sync + fmt::Debug {
    /// `Undefined` for a key the bag does not hold.
    fn get(&self, key: &str) -> Value;
    /// The keys the bag can enumerate; a store that cannot enumerate returns none.
    fn keys(&self) -> Vec<Arc<str>> {
        vec![]
    }
}

/// A namespace over an [`IndexMap`] — what `{"$namespace": {…}}` decodes to, and
/// the easy way to build one in tests.
#[derive(Debug)]
pub struct MapNamespace {
    map: IndexMap<Arc<str>, Value>,
}

impl MapNamespace {
    pub fn new(map: IndexMap<Arc<str>, Value>) -> Self {
        Self { map }
    }
}

impl Namespace for MapNamespace {
    fn get(&self, key: &str) -> Value {
        self.map.get(key).cloned().unwrap_or(Value::Undefined)
    }

    fn keys(&self) -> Vec<Arc<str>> {
        self.map.keys().cloned().collect()
    }
}

/// A callable's function: args in, a [`Value`] out.
pub type CallFn = Arc<dyn Fn(&[Value]) -> Value + Send + Sync>;

/// A function carried as a value — a store method or a local function. Only
/// handlers may call one; an expression may pass it around and compare it.
#[derive(Clone)]
pub struct CallableRef {
    name: Arc<str>,
    call: CallFn,
}

impl CallableRef {
    pub fn new(
        name: impl Into<Arc<str>>,
        call: impl Fn(&[Value]) -> Value + Send + Sync + 'static,
    ) -> Self {
        Self {
            name: name.into(),
            call: Arc::new(call),
        }
    }

    /// A callable that only carries its name — what `{"$callable": "…"}`
    /// decodes to. Calling it answers `Undefined`.
    pub fn named(name: impl Into<Arc<str>>) -> Self {
        Self::new(name, |_| Value::Undefined)
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn call(&self, args: &[Value]) -> Value {
        (self.call)(args)
    }

    fn ptr_eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.call, &other.call)
    }
}

impl fmt::Debug for CallableRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Callable({})", self.name)
    }
}

/// Every value a template expression can hold.
///
/// `PartialEq` is deliberately absent: equality in the language is JavaScript's
/// `===`, which for [`Value::List`], [`Value::Obj`], [`Value::Namespace`] and
/// [`Value::Callable`] is identity, not contents — use [`Value::strict_eq`].
/// Compare decoded JSON with `to_json` equality instead.
#[derive(Clone)]
pub enum Value {
    Undefined,
    Null,
    Bool(bool),
    Num(f64),
    Str(Arc<str>),
    List(Arc<Vec<Value>>),
    /// Insertion order kept, as in JS (`IndexMap`, not `BTreeMap`).
    Obj(Arc<IndexMap<Arc<str>, Value>>),
    Namespace(Arc<dyn Namespace>),
    Callable(CallableRef),
}

impl fmt::Debug for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Undefined => write!(f, "Undefined"),
            Value::Null => write!(f, "Null"),
            Value::Bool(b) => write!(f, "Bool({b})"),
            Value::Num(n) => write!(f, "Num({n})"),
            Value::Str(s) => write!(f, "Str({s:?})"),
            Value::List(l) => write!(f, "List({l:?})"),
            Value::Obj(o) => write!(f, "Obj({o:?})"),
            Value::Namespace(ns) => write!(f, "Namespace({ns:?})"),
            Value::Callable(c) => write!(f, "Callable({c:?})"),
        }
    }
}

impl Value {
    pub fn namespace(ns: impl Namespace + 'static) -> Value {
        Value::Namespace(Arc::new(ns))
    }

    pub fn is_undefined(&self) -> bool {
        matches!(self, Value::Undefined)
    }

    /// JavaScript truthiness: `undefined`, `null`, `false`, `0`, `-0`, `NaN`
    /// and `""` are falsy; everything else — an empty list included — is truthy.
    pub fn truthy(&self) -> bool {
        match self {
            Value::Undefined | Value::Null => false,
            Value::Bool(b) => *b,
            Value::Num(n) => *n != 0.0 && !n.is_nan(),
            Value::Str(s) => !s.is_empty(),
            Value::List(_) | Value::Obj(_) | Value::Namespace(_) | Value::Callable(_) => true,
        }
    }

    /// `Number(value)` as the evaluator's `toNumber` uses it: a non-finite
    /// answer — `NaN`, `Infinity` — becomes `0`. Always finite.
    pub fn to_number(&self) -> f64 {
        let n = match self {
            Value::Undefined => f64::NAN,
            Value::Null => 0.0,
            Value::Bool(b) => {
                if *b {
                    1.0
                } else {
                    0.0
                }
            }
            Value::Num(n) => *n,
            Value::Str(s) => s.trim().parse::<f64>().unwrap_or(f64::NAN),
            Value::List(l) => match l.len() {
                0 => 0.0,
                1 => return l[0].to_number(),
                _ => f64::NAN,
            },
            Value::Obj(_) | Value::Namespace(_) | Value::Callable(_) => f64::NAN,
        };
        if n.is_finite() {
            n
        } else {
            0.0
        }
    }

    /// `String(value)` — JavaScript's raw conversion. Differs from
    /// [`Value::to_text`] only for `null` (`"null"`) and `undefined`
    /// (`"undefined"`).
    pub fn js_string(&self) -> String {
        match self {
            Value::Undefined => "undefined".to_string(),
            Value::Null => "null".to_string(),
            Value::Bool(b) => b.to_string(),
            Value::Num(n) => js_num_text(*n),
            Value::Str(s) => s.to_string(),
            Value::List(l) => l
                .iter()
                .map(|v| v.to_text().to_string())
                .collect::<Vec<_>>()
                .join(","),
            Value::Obj(_) | Value::Namespace(_) => "[object Object]".to_string(),
            Value::Callable(c) => format!("function {}() {{ [native code] }}", c.name()),
        }
    }

    /// The language's defined conversion to text (`asText` in `where.ts`):
    /// `null`/`undefined` read as nothing, everything else as `String` prints.
    /// Template interpolation and `+` with a string side share it.
    pub fn to_text(&self) -> Arc<str> {
        match self {
            Value::Undefined | Value::Null => "".into(),
            _ => self.js_string().into(),
        }
    }

    /// The value fit to leave the evaluator (`settle` in `evaluate.ts`): a
    /// namespace in a value position is `Undefined`, and so is a callable —
    /// `readValue` refuses a function that is not a tagged callback or a
    /// reactive accessor. There are no tags yet; when a host can hand over a
    /// callback callable, this is where the distinction lands.
    pub fn settle(&self) -> Value {
        match self {
            Value::Namespace(_) | Value::Callable(_) => Value::Undefined,
            _ => self.clone(),
        }
    }

    /// `===`, exactly: `undefined === undefined` and `null === null` are true,
    /// `NaN === NaN` is false, and containers compare by identity.
    pub fn strict_eq(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Undefined, Value::Undefined) | (Value::Null, Value::Null) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Num(a), Value::Num(b)) => a == b,
            (Value::Str(a), Value::Str(b)) => a == b,
            (Value::List(a), Value::List(b)) => Arc::ptr_eq(a, b),
            (Value::Obj(a), Value::Obj(b)) => Arc::ptr_eq(a, b),
            (Value::Namespace(a), Value::Namespace(b)) => Arc::ptr_eq(a, b),
            (Value::Callable(a), Value::Callable(b)) => a.ptr_eq(b),
            _ => false,
        }
    }

    /// The JSON encoding shared with the conformance vectors: plain JSON, with
    /// the markers for the values JSON cannot hold. Object key order is kept.
    /// A whole number writes as a JSON integer, as `JSON.stringify` prints
    /// `2` for `2.0`; `-0` and the infinities carry the `$number` marker.
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Value::Undefined => marker("$undefined", true.into()),
            Value::Null => serde_json::Value::Null,
            Value::Bool(b) => (*b).into(),
            Value::Num(n) => {
                if n.is_nan() {
                    marker("$nan", true.into())
                } else if *n == 0.0 && n.is_sign_negative() {
                    // `-0` — JSON prints `0`, but `1/-0` is `-Infinity`.
                    marker("$number", "-0".into())
                } else if !n.is_finite() {
                    marker(
                        "$number",
                        if *n > 0.0 { "Infinity" } else { "-Infinity" }.into(),
                    )
                } else if n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_992.0 {
                    // A whole number within `Number.MAX_SAFE_INTEGER` writes as
                    // a JSON integer — `2`, not `2.0`.
                    (*n as i64).into()
                } else {
                    (*n).into()
                }
            }
            Value::Str(s) => s.as_ref().into(),
            Value::List(l) => serde_json::Value::Array(l.iter().map(|v| v.to_json()).collect()),
            Value::Obj(o) => {
                let map = o
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_json()))
                    .collect();
                serde_json::Value::Object(map)
            }
            Value::Namespace(ns) => {
                let inner: serde_json::Map<String, serde_json::Value> = ns
                    .keys()
                    .iter()
                    .map(|k| (k.to_string(), ns.get(k).to_json()))
                    .collect();
                // `encode.ts`: a namespace with no enumerable members is opaque.
                if inner.is_empty() {
                    marker("$namespace", true.into())
                } else {
                    marker("$namespace", serde_json::Value::Object(inner))
                }
            }
            Value::Callable(c) => marker("$callable", c.name().into()),
        }
    }

    /// The inverse of [`Value::to_json`]. A marker is only read when it is the
    /// object's only key, so a record that happens to carry one of these names
    /// beside its own fields decodes as an ordinary object — `$localMetaEntry`
    /// excepted: `encode.ts` reads it wherever the key appears, beside
    /// `touched` and `errors`.
    pub fn from_json(json: &serde_json::Value) -> Value {
        match json {
            serde_json::Value::Null => Value::Null,
            serde_json::Value::Bool(b) => Value::Bool(*b),
            serde_json::Value::Number(n) => Value::Num(n.as_f64().unwrap_or(f64::NAN)),
            serde_json::Value::String(s) => Value::Str(s.as_str().into()),
            serde_json::Value::Array(a) => {
                Value::List(Arc::new(a.iter().map(Value::from_json).collect()))
            }
            serde_json::Value::Object(o) if o.contains_key("$localMetaEntry") => {
                local_meta_entry(o)
            }
            serde_json::Value::Object(o) if o.len() == 1 => {
                if o.get("$undefined") == Some(&serde_json::Value::Bool(true)) {
                    Value::Undefined
                } else if o.get("$nan") == Some(&serde_json::Value::Bool(true)) {
                    Value::Num(f64::NAN)
                } else if let Some(serde_json::Value::String(text)) = o.get("$number") {
                    // `-0`, `Infinity`, `-Infinity`; anything else is `Number(t)`
                    // — including a bigint's digits.
                    let n = match text.as_str() {
                        "Infinity" => f64::INFINITY,
                        "-Infinity" => f64::NEG_INFINITY,
                        other => other.parse::<f64>().unwrap_or(f64::NAN),
                    };
                    Value::Num(n)
                } else if o.get("$namespace") == Some(&serde_json::Value::Bool(true)) {
                    // An opaque namespace: nothing to enumerate, `get` misses.
                    Value::Namespace(Arc::new(MapNamespace::new(IndexMap::new())))
                } else if let Some(serde_json::Value::Object(bag)) = o.get("$namespace") {
                    Value::Namespace(Arc::new(MapNamespace::new(
                        bag.iter()
                            .map(|(k, v)| (k.as_str().into(), Value::from_json(v)))
                            .collect(),
                    )))
                } else if let Some(serde_json::Value::String(name)) = o.get("$callable") {
                    Value::Callable(CallableRef::named(name.as_str()))
                } else {
                    obj_from_map(o)
                }
            }
            serde_json::Value::Object(o) => obj_from_map(o),
        }
    }
}

/// `{"$localMetaEntry": true, touched, errors}` — a form field's meta, in the
/// shape the `error`/`valid`/`touched`/`formValid` built-ins read it: an
/// object whose `touched` and `errors` call without arguments (`encode.ts`'s
/// `decodeValue`). Re-encoding it writes the callables' `$callable` markers,
/// as `encodeValue` does for the TS functions.
fn local_meta_entry(o: &serde_json::Map<String, serde_json::Value>) -> Value {
    Value::Obj(Arc::new(
        ["touched", "errors"]
            .into_iter()
            .map(|key| {
                let value = o.get(key).map(Value::from_json).unwrap_or(Value::Undefined);
                (
                    Arc::from(key),
                    Value::Callable(CallableRef::new(key, move |_| value.clone())),
                )
            })
            .collect(),
    ))
}

fn obj_from_map(o: &serde_json::Map<String, serde_json::Value>) -> Value {
    Value::Obj(Arc::new(
        o.iter()
            .map(|(k, v)| (k.as_str().into(), Value::from_json(v)))
            .collect(),
    ))
}

fn marker(key: &str, value: serde_json::Value) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    map.insert(key.to_string(), value);
    serde_json::Value::Object(map)
}

/// A number as JavaScript's `String` prints it: `NaN`, `Infinity`, integers
/// without a fraction, and exponential text below `1e-6` or at `1e21` and up.
fn js_num_text(n: f64) -> String {
    if n.is_nan() {
        return "NaN".to_string();
    }
    if n == 0.0 {
        return "0".to_string(); // also -0
    }
    if n == f64::INFINITY {
        return "Infinity".to_string();
    }
    if n == f64::NEG_INFINITY {
        return "-Infinity".to_string();
    }
    let a = n.abs();
    if !(1e-6..1e21).contains(&a) {
        // Rust prints "1e21"/"5e-7"; JavaScript wants "1e+21"/"5e-7".
        let s = format!("{n:e}");
        if let Some((mantissa, exp)) = s.split_once('e') {
            let sign = if exp.starts_with('-') { "" } else { "+" };
            return format!("{mantissa}e{sign}{exp}");
        }
        return s;
    }
    if n.fract() == 0.0 {
        return format!("{n:.0}");
    }
    format!("{n}")
}

impl From<bool> for Value {
    fn from(b: bool) -> Value {
        Value::Bool(b)
    }
}
impl From<f64> for Value {
    fn from(n: f64) -> Value {
        Value::Num(n)
    }
}
impl From<usize> for Value {
    fn from(n: usize) -> Value {
        Value::Num(n as f64)
    }
}
impl From<i64> for Value {
    fn from(n: i64) -> Value {
        Value::Num(n as f64)
    }
}
impl From<i32> for Value {
    fn from(n: i32) -> Value {
        Value::Num(n as f64)
    }
}
impl From<u32> for Value {
    fn from(n: u32) -> Value {
        Value::Num(n as f64)
    }
}
impl From<&str> for Value {
    fn from(s: &str) -> Value {
        Value::Str(s.into())
    }
}
impl From<String> for Value {
    fn from(s: String) -> Value {
        Value::Str(s.into())
    }
}
impl From<Arc<str>> for Value {
    fn from(s: Arc<str>) -> Value {
        Value::Str(s)
    }
}
impl From<Vec<Value>> for Value {
    fn from(l: Vec<Value>) -> Value {
        Value::List(Arc::new(l))
    }
}
impl From<IndexMap<Arc<str>, Value>> for Value {
    fn from(o: IndexMap<Arc<str>, Value>) -> Value {
        Value::Obj(Arc::new(o))
    }
}
impl From<MapNamespace> for Value {
    fn from(ns: MapNamespace) -> Value {
        Value::Namespace(Arc::new(ns))
    }
}
impl From<CallableRef> for Value {
    fn from(c: CallableRef) -> Value {
        Value::Callable(c)
    }
}

impl Serialize for Value {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Value {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Value, D::Error> {
        Ok(Value::from_json(&serde_json::Value::deserialize(
            deserializer,
        )?))
    }
}
