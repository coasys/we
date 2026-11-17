//! The syntax tree — one variant per `Expr` kind in `ast.ts`. Internal to the
//! crate: `Expr` is opaque above the API, so the grammar can grow here without
//! touching signatures.
//!
//! Spans are not kept: errors are a parse-time concern and the printer needs
//! only structure and precedence.

/// The names a reference can start from that are neither a store nor a macro
/// variable — `WELL_KNOWN_ROOTS` in `ast.ts`, kept for callers that classify
/// references.
pub const WELL_KNOWN_ROOTS: [&str; 10] = [
    "local",
    "me",
    "currentDataset",
    "event",
    "arg",
    "result",
    "index",
    "prev",
    "surface",
    "item",
];

/// Roots that only exist once a callback has fired — `CALL_TIME_ROOTS`.
pub const CALL_TIME_ROOTS: [&str; 3] = ["event", "arg", "result"];

#[derive(Debug)]
pub(crate) enum Node {
    Literal(Literal),
    /// A backtick string: literal runs interleaved with hole expressions.
    Template(Vec<TemplateNode>),
    Ident(String),
    Member {
        object: Box<Node>,
        property: String,
    },
    Index {
        object: Box<Node>,
        index: Box<Node>,
    },
    Unary {
        op: UnaryOp,
        operand: Box<Node>,
    },
    Binary {
        op: BinaryOp,
        left: Box<Node>,
        right: Box<Node>,
    },
    Logical {
        op: LogicalOp,
        left: Box<Node>,
        right: Box<Node>,
    },
    Conditional {
        test: Box<Node>,
        consequent: Box<Node>,
        alternate: Box<Node>,
    },
    /// A library call. Written in method shape — `items.count()` — the
    /// `receiver` is set; at eval time it is prepended to `args`, exactly as
    /// `evaluate.ts` unshifts it.
    Call {
        callee: String,
        receiver: Option<Box<Node>>,
        args: Vec<Node>,
    },
    /// `items.filter(x, x.done)` — the one place the grammar binds a name.
    Macro {
        name: MacroName,
        receiver: Box<Node>,
        variable: String,
        body: Box<Node>,
    },
    List(Vec<Node>),
    Object(Vec<(String, Node)>),
}

/// A template literal's parts — the parsed form of `TemplatePart`.
#[derive(Debug)]
pub(crate) enum TemplateNode {
    Text(String),
    Hole(Box<Node>),
}

#[derive(Debug)]
pub(crate) enum Literal {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UnaryOp {
    Not,
    Neg,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BinaryOp {
    Eq,
    Ne,
    Lt,
    Gt,
    Le,
    Ge,
    In,
    Add,
    Sub,
    Mul,
    Div,
    Mod,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LogicalOp {
    And,
    Or,
    Nullish,
}

/// `MACRO_NAMES` — a call in method shape (`receiver.name(var, body)`) with
/// one of these names and an `ident ,` head is a comprehension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MacroName {
    Filter,
    Map,
    Find,
    Exists,
    All,
}

impl MacroName {
    pub(crate) fn from_str(name: &str) -> Option<Self> {
        match name {
            "filter" => Some(MacroName::Filter),
            "map" => Some(MacroName::Map),
            "find" => Some(MacroName::Find),
            "exists" => Some(MacroName::Exists),
            "all" => Some(MacroName::All),
            _ => None,
        }
    }

    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            MacroName::Filter => "filter",
            MacroName::Map => "map",
            MacroName::Find => "find",
            MacroName::Exists => "exists",
            MacroName::All => "all",
        }
    }
}
