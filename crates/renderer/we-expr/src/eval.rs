//! The evaluator: `eval(&Expr, &dyn Env) -> Value`. Total — nothing throws.
//!
//! Mirrors `evaluate.ts`: every read is `readValue`'d (an untagged callable
//! reads `undefined`), every value that leaves the tree is `settle`'d (a
//! namespace in a value position is `undefined`), `&&`/`||` answer with
//! booleans, `==` is `===`, `in` is `Array.includes` (SameValueZero), and a
//! division or modulo by zero is `0`.
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
pub(crate) fn eval_node(node: &Node, env: &dyn Env) -> Value {
    let mut tasks: Vec<Task> = vec![Task::Eval(node)];
    let mut values: Vec<Value> = Vec::new();
    let pop = |values: &mut Vec<Value>| values.pop().unwrap_or(Value::Undefined);
    while let Some(task) = tasks.pop() {
        match task {
            Task::Push(v) => values.push(v),
            Task::Eval(node) => match node {
                Node::Literal(lit) => values.push(match lit {
                    Literal::Null => Value::Null,
                    Literal::Bool(b) => (*b).into(),
                    Literal::Num(n) => (*n).into(),
                    Literal::Str(s) => s.as_str().into(),
                }),
                Node::Ident(name) => values.push(
                    env.root(name)
                        .map(|v| v.read_value())
                        .unwrap_or(Value::Undefined),
                ),
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
                let v = pop(&mut values);
                values.push(v.settle());
            }
            Task::Binary(op) => {
                let right = pop(&mut values);
                let left = pop(&mut values);
                values.push(eval_binary(op, &left, &right));
            }
            Task::Unary(op) => {
                let operand = pop(&mut values);
                values.push(match op {
                    UnaryOp::Not => Value::Bool(!operand.truthy()),
                    UnaryOp::Neg => (-operand.to_number()).into(),
                });
            }
            Task::LogicalTail { op, right } => {
                let left = pop(&mut values);
                match op {
                    // `&&`/`||` answer with a boolean, not an operand as
                    // JavaScript does — `??` is the value-picker.
                    LogicalOp::And => {
                        if left.truthy() {
                            tasks.push(Task::LogicalRhs);
                            tasks.push(Task::Settle);
                            tasks.push(Task::Eval(right));
                        } else {
                            values.push(Value::Bool(false));
                        }
                    }
                    LogicalOp::Or => {
                        if left.truthy() {
                            values.push(Value::Bool(true));
                        } else {
                            tasks.push(Task::LogicalRhs);
                            tasks.push(Task::Settle);
                            tasks.push(Task::Eval(right));
                        }
                    }
                    LogicalOp::Nullish => {
                        if matches!(left, Value::Undefined | Value::Null) {
                            tasks.push(Task::Eval(right));
                        } else {
                            values.push(left);
                        }
                    }
                }
            }
            Task::LogicalRhs => {
                let v = pop(&mut values);
                values.push(Value::Bool(v.truthy()));
            }
            Task::ReadMember(property) => {
                let base = pop(&mut values);
                values.push(read_property(&base, property));
            }
            Task::ReadIndex => {
                let index = pop(&mut values);
                let base = pop(&mut values);
                values.push(read_index(&base, &index));
            }
            Task::CondTail {
                consequent,
                alternate,
            } => {
                let test = pop(&mut values);
                tasks.push(Task::Eval(if test.truthy() {
                    consequent
                } else {
                    alternate
                }));
            }
            Task::CallFinish { callee, argc } => {
                let argv = values.split_off(values.len().saturating_sub(argc));
                values.push(call_function(callee, &argv, env));
            }
            Task::MacroFinish {
                name,
                variable,
                body,
            } => {
                let receiver = pop(&mut values);
                values.push(crate::macros::eval_macro(
                    name, &receiver, variable, body, env,
                ));
            }
            Task::FinishTemplate(count) => {
                let parts = values.split_off(values.len().saturating_sub(count));
                let mut out = String::new();
                for part in &parts {
                    out.push_str(&part.to_text());
                }
                values.push(out.into());
            }
            Task::FinishList(count) => {
                let items = values.split_off(values.len().saturating_sub(count));
                values.push(Value::List(items.into()));
            }
            Task::FinishObject(props) => {
                let vals = values.split_off(values.len().saturating_sub(props.len()));
                let mut object = indexmap::IndexMap::new();
                for ((key, _), v) in props.iter().zip(vals) {
                    object.insert(key.as_str().into(), v);
                }
                values.push(object.into());
            }
        }
    }
    pop(&mut values)
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
/// evaluate.ts): the denied names first, then a namespace's `get`, then the
/// value's own data — a string answering only `length`, a list `length` and
/// numeric keys, an object its own keys. Anything else is `Undefined`.
fn read_property(object: &Value, property: &str) -> Value {
    if crate::DENIED_PROPERTIES.contains(&property) {
        return Value::Undefined;
    }
    match object {
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
    }
}

/// `object[index]` (`readIndex` in evaluate.ts). A numeric index reaches only
/// a list's elements and a string's UTF-16 code units — an object answers its
/// named keys through a *string* index alone, so `obj[1]` is `Undefined`
/// while `obj["1"]` can hit.
fn read_index(object: &Value, index: &Value) -> Value {
    if matches!(object, Value::Undefined | Value::Null) {
        return Value::Undefined;
    }
    if let Value::Num(n) = index {
        return match object {
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
    }
    read_property(object, &index.js_string())
}
