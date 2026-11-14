//! The evaluator: `eval(&Expr, &dyn Env) -> Value`. Total — nothing throws.
use crate::parse::{BinaryOp, Expr, Literal, LogicalOp, Node, UnaryOp};
use crate::{Env, Value, DENIED_PROPERTIES};

/// Evaluate `expr` against `env`. Never fails: a missing name is `Undefined`,
/// arithmetic on a non-number is arithmetic on `0`, and every read that cannot
/// be honoured is `Undefined`.
pub fn eval(expr: &Expr, env: &dyn Env) -> Value {
    eval_node(&expr.root, env)
}

fn eval_node(node: &Node, env: &dyn Env) -> Value {
    match node {
        Node::Literal(lit) => match lit {
            Literal::Null => Value::Null,
            Literal::Bool(b) => (*b).into(),
            Literal::Num(n) => (*n).into(),
            Literal::Str(s) => s.as_str().into(),
        },
        Node::Ident(name) => env.root(name).unwrap_or(Value::Undefined),
        Node::Member { object, property } => read_property(&eval_node(object, env), property),
        Node::Index { object, index } => {
            let base = eval_node(object, env);
            let index = eval_node(index, env).settle();
            read_index(&base, &index)
        }
        Node::Unary { op, operand } => {
            let operand = eval_node(operand, env).settle();
            match op {
                UnaryOp::Not => Value::Bool(!operand.truthy()),
                UnaryOp::Neg => (-operand.to_number()).into(),
            }
        }
        Node::Logical { op, left, right } => {
            // `&&`/`||` answer with a boolean, not an operand as JavaScript does —
            // the connectives `$and`/`$or` were, and `??` is the value-picker.
            let left = eval_node(left, env).settle();
            match op {
                LogicalOp::And => {
                    Value::Bool(left.truthy() && eval_node(right, env).settle().truthy())
                }
                LogicalOp::Or => {
                    Value::Bool(left.truthy() || eval_node(right, env).settle().truthy())
                }
            }
        }
        Node::Binary { op, left, right } => {
            let left = eval_node(left, env).settle();
            let right = eval_node(right, env).settle();
            match op {
                BinaryOp::Eq => Value::Bool(left.strict_eq(&right)),
                BinaryOp::Ne => Value::Bool(!left.strict_eq(&right)),
            }
        }
        Node::Conditional {
            test,
            consequent,
            alternate,
        } => {
            if eval_node(test, env).settle().truthy() {
                eval_node(consequent, env)
            } else {
                eval_node(alternate, env)
            }
        }
    }
}

/// `object[property]` as a template may read it (`readProperty` in evaluate.ts):
/// the denied names first, then a namespace's `get`, then the value's own
/// data — a string answering only `length`, a list `length` and numeric keys,
/// an object its own keys. Anything else is `Undefined`.
fn read_property(object: &Value, property: &str) -> Value {
    if DENIED_PROPERTIES.contains(&property) {
        return Value::Undefined;
    }
    if let Value::Namespace(ns) = object {
        return ns.get(property);
    }
    match object {
        Value::Undefined | Value::Null => Value::Undefined,
        Value::Str(s) => {
            if property == "length" {
                s.encode_utf16().count().into()
            } else {
                Value::Undefined
            }
        }
        Value::Bool(_) | Value::Num(_) | Value::Callable(_) => Value::Undefined,
        Value::Obj(o) => o.get(property).cloned().unwrap_or(Value::Undefined),
        Value::List(l) => {
            if property == "length" {
                l.len().into()
            } else if let Ok(index) = property.parse::<usize>() {
                l.get(index).cloned().unwrap_or(Value::Undefined)
            } else {
                Value::Undefined
            }
        }
        Value::Namespace(_) => unreachable!("handled above"),
    }
}

/// `object[index]` (`readIndex` in evaluate.ts). A numeric index reaches only
/// a list's elements and a string's UTF-16 code units — an object answers its
/// named keys through a *string* index alone, so `obj[1]` is `Undefined` while
/// `obj["1"]` can hit.
fn read_index(object: &Value, index: &Value) -> Value {
    if matches!(object, Value::Undefined | Value::Null) {
        return Value::Undefined;
    }
    if let Value::Num(n) = index {
        return match object {
            Value::List(l) => {
                if n.fract() == 0.0 && *n >= 0.0 {
                    l.get(*n as usize).cloned().unwrap_or(Value::Undefined)
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
