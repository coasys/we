//! [`Value`]: every value a template expression can hold.
//!
//! JSON round-trips go through [`Value::to_json`]/[`Value::from_json`], which
//! carry the four markers the shared conformance vectors use for the values
//! plain JSON cannot hold (`packages/schema-system/conformance`, task C1):
//!
//! | marker                | decodes to                        |
//! |-----------------------|-----------------------------------|
//! | `{"$undefined":true}` | [`Value::Undefined`]              |
//! | `{"$nan":true}`       | [`Value::Num(NAN)`]               |
//! | `{"$namespace":{…}}`  | [`Value::Namespace`] over a map   |
//! | `{"$callable":"…"}`   | [`Value::Callable`] of that name  |
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
///
/// `tagged` mirrors `CALLBACK_FUNCTION` in `evaluate.ts`: a callable the host
/// handed the template on purpose (a callback payload, a store method) reads
/// as a value and survives `settle`. One that merely surfaced in the data —
/// what `{"$callable": "…"}` decodes to, or a name reached through an object's
/// inherited fields — reads as `undefined`, as `readValue` refuses it.
#[derive(Clone)]
pub struct CallableRef {
    name: Arc<str>,
    call: CallFn,
    tagged: bool,
}

impl CallableRef {
    pub fn new(
        name: impl Into<Arc<str>>,
        call: impl Fn(&[Value]) -> Value + Send + Sync + 'static,
    ) -> Self {
        Self {
            name: name.into(),
            call: Arc::new(call),
            tagged: true,
        }
    }

    /// A callable that only carries its name. Calling it answers `Undefined`.
    pub fn named(name: impl Into<Arc<str>>) -> Self {
        Self::new(name, |_| Value::Undefined)
    }

    /// A callable the template may see mid-evaluation but that `readValue`
    /// refuses — the decoded form of a `{"$callable": "…"}` marker and of a
    /// name inherited from an object. Calling it answers `Undefined`.
    pub(crate) fn untagged(name: impl Into<Arc<str>>) -> Self {
        let mut c = Self::named(name);
        c.tagged = false;
        c
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Whether `readValue` lets it through — `CALLBACK_FUNCTION in fn` in the
    /// TypeScript evaluator. `new` and `named` produce tagged callables; the
    /// vector marker produces untagged ones.
    pub fn tagged(&self) -> bool {
        self.tagged
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

    /// `Number(value)`, unclamped: `NaN` and the infinities stay. `plural`
    /// needs the raw answer (`Number([1]) === 1`); arithmetic needs
    /// [`Value::to_number`]'s finite clamp.
    pub fn js_number(&self) -> f64 {
        match self {
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
            Value::Str(s) => js_number_str(s),
            Value::List(l) => match l.len() {
                0 => 0.0,
                1 => l[0].js_number(),
                _ => f64::NAN,
            },
            Value::Obj(_) | Value::Namespace(_) | Value::Callable(_) => f64::NAN,
        }
    }

    /// `Number(value)` as the evaluator's `toNumber` uses it: a non-finite
    /// answer — `NaN`, `Infinity` — becomes `0`. Always finite.
    pub fn to_number(&self) -> f64 {
        let n = self.js_number();
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

    /// `readValue` in `evaluate.ts`: an untagged callable reads as
    /// `undefined`; everything else passes. There is no reactive-accessor
    /// case — envs resolve their accessors before a value reaches the tree.
    pub fn read_value(&self) -> Value {
        match self {
            Value::Callable(c) if !c.tagged() => Value::Undefined,
            _ => self.clone(),
        }
    }

    /// The value fit to leave the evaluator (`settle` in `evaluate.ts`): a
    /// namespace in a value position is `Undefined`, an untagged callable
    /// likewise; everything else is itself. Callback payloads arrive already
    /// unwrapped, so there is no raw case here.
    pub fn settle(&self) -> Value {
        match self.read_value() {
            Value::Namespace(_) => Value::Undefined,
            value => value,
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
    /// the markers for the values JSON cannot hold — `undefined`, `NaN`, `-0`,
    /// the infinities, callables and namespaces. Object key order is kept.
    /// `{"$namespace": true}` encodes an opaque namespace — one the encoder
    /// could not enumerate.
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Value::Undefined => marker("$undefined", true.into()),
            Value::Null => serde_json::Value::Null,
            Value::Bool(b) => (*b).into(),
            Value::Num(n) => {
                if n.is_nan() {
                    marker("$nan", true.into())
                } else if *n == 0.0 && n.is_sign_negative() {
                    marker("$number", "-0".into())
                } else if *n == f64::INFINITY {
                    marker("$number", "Infinity".into())
                } else if *n == f64::NEG_INFINITY {
                    marker("$number", "-Infinity".into())
                } else if n.fract() == 0.0 && n.abs() <= 9.007_199_254_740_992e15 {
                    // The encoder writes integers as integers — `1`, not
                    // `1.0` — matching what `JSON.stringify(1)` says.
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
    /// beside its own fields decodes as an ordinary object. A `{"$callable":…}`
    /// decodes to an *untagged* callable — `readValue` refuses it, as the
    /// decoded function carries no `CALLBACK_FUNCTION` mark.
    pub fn from_json(json: &serde_json::Value) -> Value {
        match json {
            serde_json::Value::Null => Value::Null,
            serde_json::Value::Bool(b) => Value::Bool(*b),
            serde_json::Value::Number(n) => Value::Num(n.as_f64().unwrap_or(f64::NAN)),
            serde_json::Value::String(s) => Value::Str(s.as_str().into()),
            serde_json::Value::Array(a) => {
                Value::List(Arc::new(a.iter().map(Value::from_json).collect()))
            }
            serde_json::Value::Object(o) if o.len() == 1 => {
                if o.contains_key("$undefined") {
                    Value::Undefined
                } else if o.contains_key("$nan") {
                    Value::Num(f64::NAN)
                } else if let Some(text) = o.get("$number") {
                    Value::Num(match text {
                        // `Number(t)` on the decoded payload: a string parses,
                        // a number is itself, anything else is `NaN`.
                        serde_json::Value::String(s) => js_number_str(s),
                        serde_json::Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
                        _ => f64::NAN,
                    })
                } else if let Some(name) = o.get("$callable") {
                    Value::Callable(CallableRef::untagged(name.as_str().unwrap_or("anonymous")))
                } else if let Some(members) = o.get("$namespace") {
                    match members {
                        serde_json::Value::Object(bag) => {
                            Value::Namespace(Arc::new(MapNamespace::new(
                                bag.iter()
                                    .map(|(k, v)| (k.as_str().into(), Value::from_json(v)))
                                    .collect(),
                            )))
                        }
                        // `{"$namespace": true}` and anything else: opaque.
                        _ => Value::Namespace(Arc::new(MapNamespace::new(IndexMap::new()))),
                    }
                } else {
                    obj_from_map(o)
                }
            }
            serde_json::Value::Object(o) => obj_from_map(o),
        }
    }
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

/// `Number(string)` — the spellings JavaScript accepts that Rust's `f64`
/// parser does not (`"0x…"` hex, `"0b…"`/`"0o…"`, a BigInt `"…n"` which reads
/// `NaN`, `"+Infinity"`), and the spellings Rust accepts that JavaScript does
/// not (`"inf"`, `"nan"` in any case). An empty or all-whitespace string is 0.
pub(crate) fn js_number_str(s: &str) -> f64 {
    let t = s.trim();
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    // `parse::<f64>` takes "inf"/"infinity"/"nan" case-insensitively; JS does
    // not — refuse those spellings before they become real numbers.
    let lower = t.to_ascii_lowercase();
    let digits = lower.trim_start_matches(['+', '-']);
    if digits == "inf" || digits == "infinity" || digits == "nan" {
        return f64::NAN;
    }
    let (sign, rest) = match t.strip_prefix('-') {
        Some(rest) => (-1.0, rest),
        None => (1.0, t.strip_prefix('+').unwrap_or(t)),
    };
    // One sign only: `Number('+-1')` is `NaN`.
    if rest.starts_with(['+', '-']) {
        return f64::NAN;
    }
    if let Some(hex) = rest.strip_prefix("0x").or_else(|| rest.strip_prefix("0X")) {
        // Accumulate in f64 so huge hex saturates to Infinity, as JS does.
        let mut n = 0.0;
        for c in hex.chars() {
            match c.to_digit(16) {
                Some(d) => n = n * 16.0 + d as f64,
                None => return f64::NAN,
            }
        }
        return sign * n;
    }
    for (prefix, base) in [("0b", 2), ("0o", 8), ("0B", 2), ("0O", 8)] {
        if let Some(digits) = rest.strip_prefix(prefix) {
            let mut n = 0.0;
            for c in digits.chars() {
                match c.to_digit(base) {
                    Some(d) => n = n * base as f64 + d as f64,
                    None => return f64::NAN,
                }
            }
            return sign * n;
        }
    }
    // A BigInt literal is not a number.
    if rest.ends_with('n') {
        return f64::NAN;
    }
    rest.parse::<f64>().map(|n| sign * n).unwrap_or(f64::NAN)
}

/// A number as JavaScript's `String` prints it: `NaN`, `Infinity`, integers
/// without a fraction, and exponential text below `1e-6` or at `1e21` and up.
pub(crate) fn js_num_text(n: f64) -> String {
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
