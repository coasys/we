//! The evaluator: `eval(&Expr, &dyn Env) -> Value`. Total — nothing throws.
//!
//! Mirrors `evaluate.ts`: every read is `readValue`'d (an untagged callable
//! reads `undefined`), every value that leaves the tree is `settle`'d (a
//! namespace in a value position is `undefined`), `&&`/`||` answer with
//! booleans, `==` is `===`, `in` is `Array.includes` (SameValueZero), and a
//! division or modulo by zero is `0`.
//!
//! The read observer: an [`Env`] may answer [`Env::read_observer`] — every
//! read the evaluator performs is then reported to it once, as
//! `(path, effective value)`: `store`, `store.items`, `items.0.sig`,
//! `local.draft[0]` (an index is the evaluated index's `String` form). The
//! reported value is the one the expression sees — an accessor's answer,
//! invoked once per syntactic read. An env leaving the default `None` pays
//! only the check: no path strings are built, nothing is reported.
use crate::ast::*;
use crate::{Env, Expr, Value};

/// Evaluate `expr` against `env`. Never fails: a missing name is `Undefined`,
/// arithmetic on a non-number is arithmetic on `0`, and every read that cannot
/// be honoured is `Undefined`.
pub fn eval(expr: &Expr, env: &dyn Env) -> Value {
    eval_node(&expr.root, env).settle()
}

/// A step of the evaluator. `Eval` expands a node into child `Eval`s plus the
/// continuation that combines their values; continuations run after their
/// inputs are on the value stack. Pushing continuations first and children in
/// reverse keeps evaluation strictly left-to-right.
enum Task<'a> {
    /// Evaluate a node — pushes exactly one value.
    Eval(&'a Node),
    /// `settle` the top value.
    Settle,
    /// Push a value directly (a template's literal text).
    Push(Value),
    /// `eval_binary` over the top two values.
    Binary(BinaryOp),
    /// Apply the unary operator to the top value.
    Unary(UnaryOp),
    /// The left operand is on the stack: decide if `right` evaluates.
    LogicalTail { op: LogicalOp, right: &'a Node },
    /// `Bool(top.truthy())` — the `&&`/`||` right side.
    LogicalRhs,
    /// `read_property` on the top value.
    ReadMember(&'a str),
    /// `read_index` over object and index on the stack.
    ReadIndex,
    /// The test is on the stack; pick an arm to evaluate.
    CondTail {
        consequent: &'a Node,
        alternate: &'a Node,
    },
    /// Dispatch `callee` with `argc` stack values as argv (receiver first).
    CallFinish { callee: &'a str, argc: usize },
    /// The settled receiver feeds the comprehension.
    MacroFinish {
        name: MacroName,
        variable: &'a str,
        body: &'a Node,
    },
    /// Join `count` values' `to_text`s into a template string.
    FinishTemplate(usize),
    /// Collect `count` values into a list.
    FinishList(usize),
    /// Collect values into an object with these keys.
    FinishObject(&'a [(String, Node)]),
}

/// Evaluate `node` — an explicit task stack, not recursion. A flat chain
/// (`a+a+…`, `x.y.z…`, `a[0][0]…`) or a stack of nested template holes can
/// be arbitrarily deep in a ≤4000-unit source, and `evaluate.ts` has no
/// depth cap — so neither do we: the depth lives on the heap.
///
/// The read observer rides the value stack: every slot pairs a value with
/// the name it was read under, when the read had one — `store`,
/// `store.items`, `items.0` — so a member or index read through it composes
/// and reports under the chain's own path (`store.items.0.sig`). A value
/// pick — `? :`, `??` — carries the selected chain's name with its value:
/// `(cond ? store.a : store.b).x` reads as `store.b.x`. A call's answer, a
/// literal, an operator's result have no name: reads through them are the
/// caller's own inputs and compose no path. With no observer every slot's
/// name is `None` and no path string is ever built.
pub(crate) fn eval_node(node: &Node, env: &dyn Env) -> Value {
    let obs = env.read_observer();
    let mut tasks: Vec<Task> = vec![Task::Eval(node)];
    let mut values: Vec<(Value, Option<String>)> = Vec::new();
    let pop = |values: &mut Vec<(Value, Option<String>)>| {
        values.pop().unwrap_or((Value::Undefined, None))
    };
    while let Some(task) = tasks.pop() {
        match task {
            Task::Push(v) => values.push((v, None)),
            Task::Eval(node) => match node {
                Node::Literal(lit) => values.push((
                    match lit {
                        Literal::Null => Value::Null,
                        Literal::Bool(b) => (*b).into(),
                        Literal::Num(n) => (*n).into(),
                        Literal::Str(s) => s.as_str().into(),
                    },
                    None,
                )),
                Node::Ident(name) => values.push(eval_ident(name, env, obs)),
                Node::Template(parts) => {
                    tasks.push(Task::FinishTemplate(parts.len()));
                    for part in parts.iter().rev() {
                        match part {
                            TemplateNode::Text(t) => tasks.push(Task::Push(t.as_str().into())),
                            TemplateNode::Hole(inner) => {
                                tasks.push(Task::Settle);
                                tasks.push(Task::Eval(inner));
                            }
                        }
                    }
                }
                Node::Member { object, property } => {
                    // The object of a read is NOT a value position — a
                    // namespace is still a bag here, not `undefined`.
                    tasks.push(Task::ReadMember(property));
                    tasks.push(Task::Eval(object));
                }
                Node::Index { object, index } => {
                    tasks.push(Task::ReadIndex);
                    tasks.push(Task::Settle);
                    tasks.push(Task::Eval(index));
                    tasks.push(Task::Eval(object));
                }
                Node::Unary { op, operand } => {
                    tasks.push(Task::Unary(*op));
                    tasks.push(Task::Settle);
                    tasks.push(Task::Eval(operand));
                }
                Node::Logical { op, left, right } => {
                    tasks.push(Task::LogicalTail { op: *op, right });
                    tasks.push(Task::Settle);
                    tasks.push(Task::Eval(left));
                }
                Node::Binary { op, left, right } => {
                    tasks.push(Task::Binary(*op));
                    tasks.push(Task::Settle);
                    tasks.push(Task::Eval(right));
                    tasks.push(Task::Settle);
                    tasks.push(Task::Eval(left));
                }
                Node::Conditional {
                    test,
                    consequent,
                    alternate,
                } => {
                    tasks.push(Task::CondTail {
                        consequent,
                        alternate,
                    });
                    tasks.push(Task::Settle);
                    tasks.push(Task::Eval(test));
                }
                Node::Call {
                    callee,
                    receiver,
                    args,
                } => {
                    tasks.push(Task::CallFinish {
                        callee,
                        argc: args.len() + usize::from(receiver.is_some()),
                    });
                    for a in args.iter().rev() {
                        tasks.push(Task::Settle);
                        tasks.push(Task::Eval(a));
                    }
                    if let Some(r) = receiver {
                        tasks.push(Task::Settle);
                        tasks.push(Task::Eval(r));
                    }
                }
                Node::Macro {
                    name,
                    receiver,
                    variable,
                    body,
                } => {
                    tasks.push(Task::MacroFinish {
                        name: *name,
                        variable,
                        body,
                    });
                    tasks.push(Task::Settle);
                    tasks.push(Task::Eval(receiver));
                }
                Node::List(items) => {
                    tasks.push(Task::FinishList(items.len()));
                    for i in items.iter().rev() {
                        tasks.push(Task::Settle);
                        tasks.push(Task::Eval(i));
                    }
                }
                Node::Object(props) => {
                    tasks.push(Task::FinishObject(props.as_slice()));
                    for (_, v) in props.iter().rev() {
                        tasks.push(Task::Settle);
                        tasks.push(Task::Eval(v));
                    }
                }
            },
            Task::Settle => {
                let (v, path) = pop(&mut values);
                values.push((v.settle(), path));
            }
            Task::Binary(op) => {
                let (right, _) = pop(&mut values);
                let (left, _) = pop(&mut values);
                values.push((eval_binary(op, &left, &right), None));
            }
            Task::Unary(op) => {
                let (operand, _) = pop(&mut values);
                values.push((
                    match op {
                        UnaryOp::Not => Value::Bool(!operand.truthy()),
                        UnaryOp::Neg => (-operand.to_number()).into(),
                    },
                    None,
                ));
            }
            Task::LogicalTail { op, right } => {
                let (left, left_path) = pop(&mut values);
                match op {
                    // `&&`/`||` answer with a boolean, not an operand as
                    // JavaScript does — `??` is the value-picker.
                    LogicalOp::And => {
                        if left.truthy() {
                            tasks.push(Task::LogicalRhs);
                            tasks.push(Task::Settle);
                            tasks.push(Task::Eval(right));
                        } else {
                            values.push((Value::Bool(false), None));
                        }
                    }
                    LogicalOp::Or => {
                        if left.truthy() {
                            values.push((Value::Bool(true), None));
                        } else {
                            tasks.push(Task::LogicalRhs);
                            tasks.push(Task::Settle);
                            tasks.push(Task::Eval(right));
                        }
                    }
                    LogicalOp::Nullish => {
                        if matches!(left, Value::Undefined | Value::Null) {
                            // `left ?? settle(right)` — a value boundary,
                            // unlike `?:`, which returns its arm raw.
                            tasks.push(Task::Settle);
                            tasks.push(Task::Eval(right));
                        } else {
                            // The picked value keeps the name it was read
                            // under — a read through it composes onto the
                            // left chain's own path.
                            values.push((left, left_path));
                        }
                    }
                }
            }
            Task::LogicalRhs => {
                let (v, _) = pop(&mut values);
                values.push((Value::Bool(v.truthy()), None));
            }
            Task::ReadMember(property) => {
                let (base, base_path) = pop(&mut values);
                let path = base_path.map(|p| format!("{p}.{property}"));
                let value = read_property(&base, property, path.as_deref(), obs);
                values.push((value, path));
            }
            Task::ReadIndex => {
                let (index, _) = pop(&mut values);
                let (base, base_path) = pop(&mut values);
                let path = base_path.map(|p| format!("{p}.{}", index.js_string()));
                let value = read_index(&base, &index, path.as_deref(), obs);
                values.push((value, path));
            }
            Task::CondTail {
                consequent,
                alternate,
            } => {
                let (test, _) = pop(&mut values);
                tasks.push(Task::Eval(if test.truthy() {
                    consequent
                } else {
                    alternate
                }));
            }
            Task::CallFinish { callee, argc } => {
                let argv: Vec<Value> = values
                    .split_off(values.len().saturating_sub(argc))
                    .into_iter()
                    .map(|(v, _)| v)
                    .collect();
                values.push((call_function(callee, &argv, env), None));
            }
            Task::MacroFinish {
                name,
                variable,
                body,
            } => {
                let (receiver, _) = pop(&mut values);
                values.push((
                    crate::macros::eval_macro(name, &receiver, variable, body, env),
                    None,
                ));
            }
            Task::FinishTemplate(count) => {
                let parts = values.split_off(values.len().saturating_sub(count));
                let mut out = String::new();
                for (part, _) in &parts {
                    out.push_str(&part.to_text());
                }
                values.push((out.into(), None));
            }
            Task::FinishList(count) => {
                let items: Vec<Value> = values
                    .split_off(values.len().saturating_sub(count))
                    .into_iter()
                    .map(|(v, _)| v)
                    .collect();
                values.push((Value::List(items.into()), None));
            }
            Task::FinishObject(props) => {
                let vals = values.split_off(values.len().saturating_sub(props.len()));
                let mut object = indexmap::IndexMap::new();
                for ((key, _), (v, _)) in props.iter().zip(vals) {
                    object.insert(key.as_str().into(), v);
                }
                values.push((object.into(), None));
            }
        }
    }
    pop(&mut values).0
}

/// A bare root name: bound, `readValue`'d, and reported under its own name.
/// An unbound name is `Undefined` and not a read — but it still hands its
/// name to the slot, so a read composed through it (`missing.prop`) reports
/// under `missing.prop` rather than anonymously.
fn eval_ident(
    name: &str,
    env: &dyn Env,
    obs: Option<&crate::ReadObserver<'_>>,
) -> (Value, Option<String>) {
    let value = match env.root(name) {
        Some(root) => {
            let value = root.read_value();
            if let Some(observe) = obs {
                observe(name, &value);
            }
            value
        }
        None => Value::Undefined,
    };
    (value, obs.map(|_| name.to_string()))
}

/// The binary operators, `evaluate.ts` semantics.
fn eval_binary(op: BinaryOp, left: &Value, right: &Value) -> Value {
    match op {
        BinaryOp::Eq => Value::Bool(left.strict_eq(right)),
        BinaryOp::Ne => Value::Bool(!left.strict_eq(right)),
        BinaryOp::Lt => Value::Bool(left.to_number() < right.to_number()),
        BinaryOp::Gt => Value::Bool(left.to_number() > right.to_number()),
        BinaryOp::Le => Value::Bool(left.to_number() <= right.to_number()),
        BinaryOp::Ge => Value::Bool(left.to_number() >= right.to_number()),
        BinaryOp::In => {
            // `includes` — SameValueZero, so `NaN in [NaN]` is true.
            match right {
                Value::List(l) => Value::Bool(l.iter().any(|v| same_value_zero(v, left))),
                _ => Value::Bool(false),
            }
        }
        BinaryOp::Add => {
            if let (Value::Num(a), Value::Num(b)) = (left, right) {
                (a + b).into()
            } else if matches!(left, Value::Str(_)) || matches!(right, Value::Str(_)) {
                // `String` conversion of both sides, concatenated.
                format!("{}{}", left.js_string(), right.js_string()).into()
            } else {
                (left.to_number() + right.to_number()).into()
            }
        }
        BinaryOp::Sub => (left.to_number() - right.to_number()).into(),
        BinaryOp::Mul => (left.to_number() * right.to_number()).into(),
        BinaryOp::Div => {
            let (a, b) = (left.to_number(), right.to_number());
            if b == 0.0 {
                0.0.into()
            } else {
                (a / b).into()
            }
        }
        BinaryOp::Mod => {
            let (a, b) = (left.to_number(), right.to_number());
            if b == 0.0 {
                0.0.into()
            } else {
                (a % b).into()
            }
        }
    }
}

/// `includes`' membership test — `SameValueZero`: `===` except `NaN === NaN`
/// and `-0 === +0`.
fn same_value_zero(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Num(x), Value::Num(y)) => x == y || (x.is_nan() && y.is_nan()),
        _ => a.strict_eq(b),
    }
}

/// The call dispatcher — a built-in first, then the environment's `call`, as
/// `callFunction` in `evaluate.ts`. The result is NOT settled here: a
/// namespace a host function returns stays traversable through `.`/`[]` —
/// settle happens at the value boundaries above, as `evaluate.ts` does.
fn call_function(callee: &str, args: &[Value], env: &dyn Env) -> Value {
    if let Some(f) = crate::functions::lookup(callee) {
        f(args, env)
    } else {
        env.call(callee, args)
    }
}

/// `object[property]` as a template may read it (`readProperty` in
/// evaluate.ts): the denied names first, then a namespace's `get` — checked
/// on the object as handed over AND again on what `readValue` reads, since
/// an accessor can hold a namespace — then the value's own data: a string
/// answering only `length`, a list `length` and numeric keys, an object its
/// own keys. Anything else is `Undefined`. `path` is the read's name when
/// the object stood for one — the observer hears `path → value` once, with
/// the effective answer.
fn read_property(
    object: &Value,
    property: &str,
    path: Option<&str>,
    obs: Option<&crate::ReadObserver<'_>>,
) -> Value {
    if crate::DENIED_PROPERTIES.contains(&property) {
        return Value::Undefined;
    }
    if let Value::Namespace(ns) = object {
        return observe_read(ns.get(property).read_value(), path, obs);
    }
    let value = match object.read_value() {
        Value::Namespace(ns) => ns.get(property).read_value(),
        Value::Undefined | Value::Null => Value::Undefined,
        Value::Str(s) => {
            if property == "length" {
                s.encode_utf16().count().into()
            } else {
                Value::Undefined
            }
        }
        Value::Bool(_) | Value::Num(_) | Value::Callable(_) => Value::Undefined,
        Value::Obj(o) => o
            .get(property)
            .map(|v| v.read_value())
            .unwrap_or(Value::Undefined),
        Value::List(l) => {
            if property == "length" {
                l.len().into()
            } else if let Some(index) = crate::value::canonical_index(property) {
                l.get(index)
                    .map(|v| v.read_value())
                    .unwrap_or(Value::Undefined)
            } else {
                Value::Undefined
            }
        }
    };
    observe_read(value, path, obs)
}

/// `object[index]` (`readIndex` in evaluate.ts): the object is `readValue`'d
/// first — a host call's accessor answer is traversed through its data, and a
/// namespace still reads through `read_property`. A numeric index reaches
/// only a list's elements and a string's UTF-16 code units — an object
/// answers its named keys through a *string* index alone, so `obj[1]` is
/// `Undefined` while `obj["1"]` can hit.
fn read_index(
    object: &Value,
    index: &Value,
    path: Option<&str>,
    obs: Option<&crate::ReadObserver<'_>>,
) -> Value {
    let base = object.read_value();
    if matches!(base, Value::Undefined | Value::Null) {
        return observe_read(Value::Undefined, path, obs);
    }
    if let Value::Num(n) = index {
        let value = match base {
            Value::List(l) => {
                if n.fract() == 0.0 && *n >= 0.0 {
                    l.get(*n as usize)
                        .map(|v| v.read_value())
                        .unwrap_or(Value::Undefined)
                } else {
                    Value::Undefined
                }
            }
            Value::Str(s) => s
                .encode_utf16()
                .nth(*n as usize)
                .filter(|_| n.fract() == 0.0 && *n >= 0.0)
                .map(|unit| String::from_utf16_lossy(&[unit]).into())
                .unwrap_or(Value::Undefined),
            _ => Value::Undefined,
        };
        return observe_read(value, path, obs);
    }
    read_property(&base, &index.js_string(), path, obs)
}

/// A read's exit: when both a path and an observer exist, the observer hears
/// `path → value` once; the read's answer is untouched either way.
fn observe_read(value: Value, path: Option<&str>, obs: Option<&crate::ReadObserver<'_>>) -> Value {
    if let (Some(path), Some(observe)) = (path, obs) {
        observe(path, &value);
    }
    value
}
