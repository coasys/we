//! The evaluator: `eval(&Expr, &dyn Env) -> Value`. Total — nothing throws.
//!
//! Mirrors `evaluate.ts`: every read is `readValue`'d (an untagged callable
//! reads `undefined`), every value that leaves the tree is `settle`'d (a
//! namespace in a value position is `undefined`), `&&`/`||` answer with
//! booleans, `==` is `===`, `in` is `Array.includes` (SameValueZero), and a
//! division or modulo by zero is `0`.
use crate::ast::*;
use crate::{Env, Expr, Value};

/// The deepest the evaluator recurses. A template is nowhere near this; a
/// pathological AST (parser depth is bounded, but a caller-built tree is not)
/// is settled rather than blown through the stack.
const MAX_EVAL_DEPTH: usize = 100;

/// Evaluate `expr` against `env`. Never fails: a missing name is `Undefined`,
/// arithmetic on a non-number is arithmetic on `0`, and every read that cannot
/// be honoured is `Undefined`.
pub fn eval(expr: &Expr, env: &dyn Env) -> Value {
    eval_node(&expr.root, env, 0).settle()
}

pub(crate) fn eval_node(node: &Node, env: &dyn Env, depth: usize) -> Value {
    if depth > MAX_EVAL_DEPTH {
        return Value::Undefined;
    }
    match node {
        Node::Literal(lit) => match lit {
            Literal::Null => Value::Null,
            Literal::Bool(b) => (*b).into(),
            Literal::Num(n) => (*n).into(),
            Literal::Str(s) => s.as_str().into(),
        },
        Node::Template(parts) => {
            let mut out = String::new();
            for part in parts {
                match part {
                    TemplateNode::Text(t) => out.push_str(t),
                    TemplateNode::Hole(inner) => {
                        out.push_str(&eval_node(inner, env, depth + 1).settle().to_text());
                    }
                }
            }
            out.into()
        }
        Node::Ident(name) => env
            .root(name)
            .map(|v| v.read_value())
            .unwrap_or(Value::Undefined),
        Node::Member { object, property } => {
            // The object of a read is NOT a value position — a namespace is
            // still a bag here, not `undefined`.
            let base = eval_node(object, env, depth + 1);
            read_property(&base, property)
        }
        Node::Index { object, index } => {
            let base = eval_node(object, env, depth + 1);
            let index = eval_node(index, env, depth + 1).settle();
            read_index(&base, &index)
        }
        Node::Unary { op, operand } => {
            let operand = eval_node(operand, env, depth + 1).settle();
            match op {
                UnaryOp::Not => Value::Bool(!operand.truthy()),
                UnaryOp::Neg => (-operand.to_number()).into(),
            }
        }
        Node::Logical { op, left, right } => {
            // `&&`/`||` answer with a boolean, not an operand as JavaScript
            // does — `??` is the value-picker.
            let left = eval_node(left, env, depth + 1).settle();
            match op {
                LogicalOp::And => {
                    Value::Bool(left.truthy() && eval_node(right, env, depth + 1).settle().truthy())
                }
                LogicalOp::Or => {
                    Value::Bool(left.truthy() || eval_node(right, env, depth + 1).settle().truthy())
                }
                LogicalOp::Nullish => {
                    if matches!(left, Value::Undefined | Value::Null) {
                        eval_node(right, env, depth + 1)
                    } else {
                        left
                    }
                }
            }
        }
        Node::Binary { op, left, right } => {
            let left = eval_node(left, env, depth + 1).settle();
            let right = eval_node(right, env, depth + 1).settle();
            eval_binary(*op, &left, &right)
        }
        Node::Conditional {
            test,
            consequent,
            alternate,
        } => {
            if eval_node(test, env, depth + 1).settle().truthy() {
                eval_node(consequent, env, depth + 1)
            } else {
                eval_node(alternate, env, depth + 1)
            }
        }
        Node::Call {
            callee,
            receiver,
            args,
        } => {
            let mut argv: Vec<Value> = Vec::with_capacity(args.len() + 1);
            if let Some(receiver) = receiver {
                argv.push(eval_node(receiver, env, depth + 1).settle());
            }
            for a in args {
                argv.push(eval_node(a, env, depth + 1).settle());
            }
            call_function(callee, &argv, env)
        }
        Node::Macro {
            name,
            receiver,
            variable,
            body,
        } => crate::macros::eval_macro(*name, receiver, variable, body, env, depth),
        Node::List(items) => {
            let items: Vec<Value> = items
                .iter()
                .map(|i| eval_node(i, env, depth + 1).settle())
                .collect();
            items.into()
        }
        Node::Object(props) => {
            let mut object = indexmap::IndexMap::new();
            for (key, value) in props {
                object.insert(
                    key.as_str().into(),
                    eval_node(value, env, depth + 1).settle(),
                );
            }
            object.into()
        }
    }
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
/// `callFunction` in `evaluate.ts`.
fn call_function(callee: &str, args: &[Value], env: &dyn Env) -> Value {
    if let Some(f) = crate::functions::lookup(callee) {
        f(args, env)
    } else {
        env.call(callee, args).settle()
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
            } else if let Ok(index) = property.parse::<usize>() {
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
