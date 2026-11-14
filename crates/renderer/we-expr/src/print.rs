//! The canonical printer — `printer.ts` in Rust.
//!
//! Canonical matters more than pretty: the visual editor parses an expression
//! into a structure, lets somebody edit it, and prints it back — and a print
//! that changed spacing or quoting on every round trip would make every edit
//! a diff. So one spacing, single quotes, and parentheses only where
//! precedence needs them.
use crate::ast::*;
use crate::Expr;

fn precedence_of(node: &Node) -> u8 {
    match node {
        Node::Conditional { .. } => 0,
        Node::Logical { op, .. } => match op {
            LogicalOp::Nullish => 1,
            LogicalOp::Or => 2,
            LogicalOp::And => 3,
        },
        Node::Binary { op, .. } => match op {
            BinaryOp::Eq | BinaryOp::Ne => 4,
            BinaryOp::Lt | BinaryOp::Gt | BinaryOp::Le | BinaryOp::Ge | BinaryOp::In => 5,
            BinaryOp::Add | BinaryOp::Sub => 6,
            BinaryOp::Mul | BinaryOp::Div | BinaryOp::Mod => 7,
        },
        Node::Unary { .. } => 8,
        Node::Member { .. } | Node::Index { .. } | Node::Call { .. } | Node::Macro { .. } => 9,
        _ => 10,
    }
}

/// `wrap` — equal precedence on the right of a left-associative operator
/// needs parentheses: `a - (b - c)`.
fn wrap(child: &Node, parent_precedence: u8, right_associative_side: bool) -> String {
    let own = precedence_of(child);
    let needs = if right_associative_side {
        own <= parent_precedence
    } else {
        own < parent_precedence
    };
    let printed = print_node(child);
    if needs {
        format!("({printed})")
    } else {
        printed
    }
}

/// `printExpression` — the canonical text of a parsed expression.
pub fn print(expr: &Expr) -> String {
    print_node(&expr.root)
}

fn print_node(node: &Node) -> String {
    match node {
        Node::Literal(lit) => match lit {
            Literal::Null => "null".to_string(),
            Literal::Bool(b) => b.to_string(),
            Literal::Num(n) => crate::value::js_num_text(*n),
            Literal::Str(s) => quote(s),
        },
        Node::Template(parts) => {
            let mut out = String::from("`");
            for part in parts {
                match part {
                    TemplateNode::Text(t) => out.push_str(&template_text(t)),
                    TemplateNode::Hole(inner) => {
                        out.push_str("${");
                        out.push_str(&print_node(inner));
                        out.push('}');
                    }
                }
            }
            out.push('`');
            out
        }
        Node::Ident(name) => name.clone(),
        Node::Member { object, property } => {
            format!("{}.{}", wrap(object, 9, false), property)
        }
        Node::Index { object, index } => {
            format!("{}[{}]", wrap(object, 9, false), print_node(index))
        }
        Node::Unary { op, operand } => {
            let sym = match op {
                UnaryOp::Not => "!",
                UnaryOp::Neg => "-",
            };
            format!("{}{}", sym, wrap(operand, 8, false))
        }
        Node::Binary { op, left, right } => {
            let sym = match op {
                BinaryOp::Eq => "==",
                BinaryOp::Ne => "!=",
                BinaryOp::Lt => "<",
                BinaryOp::Gt => ">",
                BinaryOp::Le => "<=",
                BinaryOp::Ge => ">=",
                BinaryOp::In => "in",
                BinaryOp::Add => "+",
                BinaryOp::Sub => "-",
                BinaryOp::Mul => "*",
                BinaryOp::Div => "/",
                BinaryOp::Mod => "%",
            };
            let prec = precedence_of(node);
            format!(
                "{} {} {}",
                wrap(left, prec, false),
                sym,
                wrap(right, prec, true)
            )
        }
        Node::Logical { op, left, right } => {
            let sym = match op {
                LogicalOp::And => "&&",
                LogicalOp::Or => "||",
                LogicalOp::Nullish => "??",
            };
            let prec = precedence_of(node);
            format!(
                "{} {} {}",
                wrap(left, prec, false),
                sym,
                wrap(right, prec, true)
            )
        }
        Node::Conditional {
            test,
            consequent,
            alternate,
        } => format!(
            "{} ? {} : {}",
            wrap(test, 1, false),
            print_node(consequent),
            print_node(alternate)
        ),
        Node::Call {
            callee,
            receiver,
            args,
        } => {
            let args = args.iter().map(print_node).collect::<Vec<_>>().join(", ");
            match receiver {
                Some(receiver) => format!("{}.{}({})", wrap(receiver, 9, false), callee, args),
                None => format!("{callee}({args})"),
            }
        }
        Node::Macro {
            name,
            receiver,
            variable,
            body,
        } => format!(
            "{}.{}({}, {})",
            wrap(receiver, 9, false),
            name.as_str(),
            variable,
            print_node(body)
        ),
        Node::List(items) => {
            let items = items.iter().map(print_node).collect::<Vec<_>>().join(", ");
            format!("[{items}]")
        }
        Node::Object(entries) => {
            if entries.is_empty() {
                return "{}".to_string();
            }
            let entries = entries
                .iter()
                .map(|(k, v)| format!("{}: {}", ident_key(k), print_node(v)))
                .collect::<Vec<_>>()
                .join(", ");
            format!("{{ {entries} }}")
        }
    }
}

/// `printLiteral` — `String(value)` for the scalars, quoted for strings.
fn quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('\'');
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('\'');
    out
}

/// An object key: bare when it reads as an identifier, single-quoted else.
fn ident_key(k: &str) -> String {
    let mut chars = k.chars();
    let ok = match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$' => {
            chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
        }
        _ => false,
    };
    if ok {
        k.to_string()
    } else {
        quote(k)
    }
}

/// Literal text inside a template: `\`, backtick and `${` are the only
/// sequences that need escaping.
fn template_text(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace("${", "\\${")
}
