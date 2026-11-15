//! `stylesheet`: a theme's `index.css` as data — the CSS subset WE's themes
//! write (and `sanitiseCss.ts` admits from users), parsed into rules,
//! matched against an element description, and cascaded the way a browser
//! does: `!important` first, then specificity, then source order.
//!
//! What it reads:
//!
//! - selectors: type (`we-button`, `*`), attributes (`[a]`, `[a='v']`,
//!   `^=`, `$=`, `*=`, `~=`, `|=`), the descendant and child combinators,
//!   `::part(name)`, `::before`/`::after`, and the state pseudo-classes
//!   `:hover`, `:active`, `:focus`, `:focus-within`, `:focus-visible`,
//!   `:disabled`;
//! - declarations, with `!important`;
//! - `@keyframes` (percent, `from`/`to`, comma-listed offsets);
//! - `@scope`/`@layer` blocks, whose rules are read as if unwrapped (the
//!   scoping is what the web's sanitiser adds; the Rust renderer only ever
//!   applies a theme's sheet inside that theme).
//!
//! What it skips — counted in [`Stylesheet::skipped`], never a panic: any
//! other at-rule (`@media`, `@supports`, `@import`, `@font-face`,
//! `@property`) and any selector using something outside the list above
//! (`.class`, `#id`, `:not()`, `:root`, …). A rule whose selector list has
//! one unsupported member keeps the others, as a browser would not — but a
//! browser would drop the whole rule, so this does too and says so.
//!
//! No egui: this module is shared by every frontend.
use std::sync::Arc;

use indexmap::IndexMap;

use crate::props::{DeclValue, Decls};

/// `::before` or `::after`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PseudoElement {
    Before,
    After,
}

impl PseudoElement {
    /// The part key layout and paint use for the generated box.
    pub fn key(self) -> &'static str {
        match self {
            PseudoElement::Before => "::before",
            PseudoElement::After => "::after",
        }
    }
}

/// The interactive states a selector can ask for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum State {
    Hover,
    Active,
    /// `:focus`, `:focus-within`, `:focus-visible` — one focus state in
    /// the renderer.
    Focus,
    /// `:disabled` (the `[disabled]` attribute matches as an attribute).
    Disabled,
}

#[derive(Debug, Clone, PartialEq)]
enum AttrOp {
    Exists,
    Eq(Arc<str>),
    Prefix(Arc<str>),
    Suffix(Arc<str>),
    Contains(Arc<str>),
    Word(Arc<str>),
    Dash(Arc<str>),
}

#[derive(Debug, Clone, PartialEq)]
struct AttrSel {
    name: Arc<str>,
    op: AttrOp,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct Compound {
    /// `None` is `*` or no type at all.
    ty: Option<Arc<str>>,
    attrs: Vec<AttrSel>,
    states: Vec<State>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Combinator {
    Descendant,
    Child,
}

/// One complex selector: compounds right to left are the subject first.
#[derive(Debug, Clone, PartialEq)]
pub struct Selector {
    /// `(combinator to the compound on the left, compound)` — the first
    /// entry is the leftmost compound (its combinator is unused).
    compounds: Vec<(Combinator, Compound)>,
    part: Option<Arc<str>>,
    pseudo: Option<PseudoElement>,
    /// States written after `::part(x)` — they ask the part's state, which
    /// in the renderer is the element's.
    part_states: Vec<State>,
    /// `(ids, classes|attrs|pseudo-classes, types|pseudo-elements)`.
    pub specificity: (u32, u32, u32),
}

impl Selector {
    /// Every state the selector needs to hold.
    pub fn states(&self) -> impl Iterator<Item = State> + '_ {
        self.compounds
            .last()
            .map(|(_, c)| c.states.iter())
            .into_iter()
            .flatten()
            .chain(self.part_states.iter())
            .copied()
    }
}

/// One declaration as written — the value is the raw text, `var()`s and
/// all; the evaluator substitutes against the theme's token table.
#[derive(Debug, Clone, PartialEq)]
pub struct Decl {
    pub prop: Arc<str>,
    pub value: Arc<str>,
    pub important: bool,
}

/// One style rule.
#[derive(Debug, Clone, PartialEq)]
pub struct Rule {
    pub selectors: Vec<Selector>,
    pub decls: Vec<Decl>,
    /// Source position — the cascade's last tie-breaker.
    pub order: usize,
}

/// One `@keyframes` block: offsets `0..=1` with the declarations at each.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Keyframes {
    pub frames: Vec<(f32, Vec<Decl>)>,
}

/// A parsed stylesheet.
#[derive(Debug, Clone, Default)]
pub struct Stylesheet {
    pub rules: Vec<Rule>,
    pub keyframes: IndexMap<Arc<str>, Keyframes>,
    /// What was not read, one line each — the prelude and why.
    pub skipped: Vec<String>,
}

/// An element as the matcher sees it: its tag and a way to read an
/// attribute (`None` for absent; a boolean attribute present is `""`).
pub struct Element<'a> {
    pub ty: &'a str,
    pub attr: &'a dyn Fn(&str) -> Option<Arc<str>>,
}

/// What a lookup asks for: the element, its ancestors nearest first, the
/// part (`None` is the host itself) and the pseudo-element.
pub struct Query<'a> {
    pub element: &'a Element<'a>,
    pub ancestors: &'a [Element<'a>],
    pub part: Option<&'a str>,
    pub pseudo: Option<PseudoElement>,
}

/// One rule that matched a query — the selector's specificity and the
/// states it needs.
#[derive(Debug, Clone)]
pub struct Matched<'s> {
    pub specificity: (u32, u32, u32),
    pub order: usize,
    pub states: Vec<State>,
    pub decls: &'s [Decl],
}

/// The cascade's answer for one state: the winning declarations, normal and
/// `!important` apart (the important ones beat what the element's own props
/// say, even in a state; the normal ones only sit where the part's own
/// declarations would).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Cascaded {
    pub normal: Decls,
    pub important: Decls,
}

impl Cascaded {
    pub fn is_empty(&self) -> bool {
        self.normal.is_empty() && self.important.is_empty()
    }

    /// The winning value of `prop`, important first.
    pub fn get(&self, prop: &str) -> Option<String> {
        self.important
            .get(prop)
            .or_else(|| self.normal.get(prop))
            .map(|v| v.text())
    }

    /// Remove and return `prop` from both maps (important wins).
    pub fn take(&mut self, prop: &str) -> Option<String> {
        let n = self.normal.shift_remove(prop);
        let i = self.important.shift_remove(prop);
        i.or(n).map(|v| v.text())
    }
}

// ── parsing ────────────────────────────────────────────────────────────────

/// Strip `/* … */` comments, leaving strings alone.
fn strip_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let b = css.as_bytes();
    let mut i = 0;
    let mut quote: Option<u8> = None;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' && i + 1 < b.len() {
                out.push_str(&css[i..i + 2]);
                i += 2;
                continue;
            }
            if c == q {
                quote = None;
            }
            push_char(&mut out, css, &mut i);
            continue;
        }
        if c == b'"' || c == b'\'' {
            quote = Some(c);
            push_char(&mut out, css, &mut i);
            continue;
        }
        if c == b'/' && b.get(i + 1) == Some(&b'*') {
            match css[i + 2..].find("*/") {
                Some(end) => i = i + 2 + end + 2,
                None => i = b.len(),
            }
            out.push(' ');
            continue;
        }
        push_char(&mut out, css, &mut i);
    }
    out
}

fn push_char(out: &mut String, s: &str, i: &mut usize) {
    let ch = s[*i..].chars().next().unwrap();
    out.push(ch);
    *i += ch.len_utf8();
}

/// The index of the first `stop` byte at nesting depth 0 (parens, brackets,
/// strings respected), from `from`.
fn find_top(s: &str, from: usize, stops: &[u8]) -> Option<usize> {
    let b = s.as_bytes();
    let mut depth = 0i32;
    let mut quote: Option<u8> = None;
    let mut i = from;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == q {
                quote = None;
            }
        } else if depth <= 0 && stops.contains(&c) {
            return Some(i);
        } else if c == b'"' || c == b'\'' {
            quote = Some(c);
        } else if c == b'(' || c == b'[' {
            depth += 1;
        } else if c == b')' || c == b']' {
            depth -= 1;
        }
        i += 1;
    }
    None
}

/// The index of the `}` closing the block whose `{` is at `open`.
fn block_end(s: &str, open: usize) -> Option<usize> {
    let b = s.as_bytes();
    let mut depth = 0i32;
    let mut i = open;
    loop {
        let at = find_top(s, i, b"{}")?;
        if b[at] == b'{' {
            depth += 1;
        } else {
            depth -= 1;
            if depth == 0 {
                return Some(at);
            }
        }
        i = at + 1;
    }
}

fn split_top(s: &str, sep: u8) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    while let Some(at) = find_top(s, start, &[sep]) {
        out.push(&s[start..at]);
        start = at + 1;
    }
    out.push(&s[start..]);
    out
}

fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Declarations of a block body.
pub fn parse_decls(body: &str) -> Vec<Decl> {
    let mut out = Vec::new();
    for part in split_top(body, b';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let Some(colon) = find_top(part, 0, b":") else {
            continue;
        };
        let prop = part[..colon].trim().to_ascii_lowercase();
        let mut value = part[colon + 1..].trim().to_string();
        let mut important = false;
        if let Some(bang) = value.rfind('!') {
            if value[bang + 1..].trim().eq_ignore_ascii_case("important") {
                important = true;
                value.truncate(bang);
            }
        }
        if prop.is_empty() {
            continue;
        }
        out.push(Decl {
            prop: Arc::from(prop.as_str()),
            value: Arc::from(one_line(&value).as_str()),
            important,
        });
    }
    out
}

impl Stylesheet {
    /// Parse `css`. Never fails: what it cannot read lands in
    /// [`skipped`](Self::skipped).
    pub fn parse(css: &str) -> Self {
        let mut sheet = Stylesheet::default();
        let css = strip_comments(css);
        sheet.parse_block(&css);
        sheet
    }

    fn parse_block(&mut self, css: &str) {
        let mut i = 0;
        while i < css.len() {
            let Some(at) = find_top(css, i, b"{;}") else {
                if !css[i..].trim().is_empty() {
                    self.skipped
                        .push(format!("{} (no block)", one_line(&css[i..])));
                }
                return;
            };
            let prelude = css[i..at].trim();
            let b = css.as_bytes()[at];
            if b != b'{' {
                // A statement (`@import …;`, `@layer a, b;`) or a stray `}`.
                if !prelude.is_empty() {
                    self.skipped
                        .push(format!("{} (statement)", one_line(prelude)));
                }
                i = at + 1;
                continue;
            }
            let Some(end) = block_end(css, at) else {
                self.skipped
                    .push(format!("{} (unclosed block)", one_line(prelude)));
                return;
            };
            let body = &css[at + 1..end];
            self.parse_rule(prelude, body);
            i = end + 1;
        }
    }

    fn parse_rule(&mut self, prelude: &str, body: &str) {
        if let Some(at) = prelude.strip_prefix('@') {
            let name: String = at
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect::<String>()
                .to_ascii_lowercase();
            let rest = at[name.len()..].trim();
            match name.as_str() {
                "keyframes" | "-webkit-keyframes" => {
                    let kf = parse_keyframes(body);
                    self.keyframes.insert(Arc::from(rest), kf);
                }
                "scope" | "layer" => self.parse_block(body),
                _ => self
                    .skipped
                    .push(format!("@{name} {} (at-rule not read)", one_line(rest))),
            }
            return;
        }
        let mut selectors = Vec::new();
        for s in split_top(prelude, b',') {
            match parse_selector(s.trim()) {
                Ok(sel) => selectors.push(sel),
                Err(why) => {
                    self.skipped.push(format!("{} ({why})", one_line(prelude)));
                    return;
                }
            }
        }
        let order = self.rules.len();
        self.rules.push(Rule {
            selectors,
            decls: parse_decls(body),
            order,
        });
    }

    /// Every rule matching `q`, in no particular order.
    pub fn matching<'s>(&'s self, q: &Query) -> Vec<Matched<'s>> {
        let mut out = Vec::new();
        for rule in &self.rules {
            // The most specific matching selector of the list is the one
            // that counts.
            let best = rule
                .selectors
                .iter()
                .filter(|s| selector_matches(s, q))
                .max_by_key(|s| s.specificity);
            if let Some(sel) = best {
                out.push(Matched {
                    specificity: sel.specificity,
                    order: rule.order,
                    states: sel.states().collect(),
                    decls: &rule.decls,
                });
            }
        }
        out
    }

    /// The custom properties the sheet declares on the theme root
    /// (`[data-we-theme='x'] { --we-…: … }`) — recorded token tables
    /// already carry them; exposed for a theme without one.
    pub fn root_vars(&self, theme: &str) -> Decls {
        let attr = |name: &str| (name == "data-we-theme").then(|| Arc::from(theme));
        let root = Element {
            ty: "",
            attr: &attr,
        };
        let q = Query {
            element: &root,
            ancestors: &[],
            part: None,
            pseudo: None,
        };
        cascade(&self.matching(&q), None).normal
    }
}

/// The cascade over `matched` for one state (`None` is the resting
/// element): a rule asking for states applies only when every one of them
/// is `state`. Later wins within a priority; a re-set property moves to the
/// end so shorthand/longhand order stays the order the winners were
/// written in.
pub fn cascade(matched: &[Matched], state: Option<State>) -> Cascaded {
    let mut applicable: Vec<&Matched> = matched
        .iter()
        .filter(|m| m.states.iter().all(|s| Some(*s) == state))
        .collect();
    applicable.sort_by_key(|m| (m.specificity, m.order));
    let mut out = Cascaded::default();
    for m in applicable {
        for d in m.decls {
            let map = if d.important {
                &mut out.important
            } else {
                &mut out.normal
            };
            for (prop, value) in expand(d) {
                map.shift_remove(prop.as_ref());
                map.insert(prop, DeclValue::Text(value));
            }
        }
    }
    out
}

/// Whether any rule in `matched` asks for `state`.
pub fn has_state(matched: &[Matched], state: State) -> bool {
    matched.iter().any(|m| m.states.contains(&state))
}

/// Shorthands the evaluator does not take, expanded to ones it does.
fn expand(d: &Decl) -> Vec<(Arc<str>, Arc<str>)> {
    let v = d.value.clone();
    let one = |p: &str, v: Arc<str>| vec![(Arc::from(p), v)];
    match d.prop.as_ref() {
        // `background: <color>` / `none` / an image — the forms themes
        // write. A layered background with position/size is left to the
        // image parser.
        "background" => {
            let t = v.trim();
            if t.eq_ignore_ascii_case("none") {
                vec![
                    (Arc::from("background-color"), Arc::from("transparent")),
                    (Arc::from("background-image"), Arc::from("none")),
                ]
            } else if t.contains("gradient(") || t.contains("url(") {
                one("background-image", v)
            } else {
                one("background-color", v)
            }
        }
        _ => one(&d.prop, v),
    }
}

fn parse_keyframes(body: &str) -> Keyframes {
    let mut kf = Keyframes::default();
    let mut i = 0;
    while let Some(open) = find_top(body, i, b"{") {
        let Some(end) = block_end(body, open) else {
            break;
        };
        let decls = parse_decls(&body[open + 1..end]);
        for sel in body[i..open].split(',') {
            let sel = sel.trim().to_ascii_lowercase();
            let off = match sel.as_str() {
                "from" => Some(0.0),
                "to" => Some(1.0),
                s => s
                    .strip_suffix('%')
                    .and_then(|n| n.trim().parse::<f32>().ok())
                    .map(|p| p / 100.0),
            };
            if let Some(off) = off {
                kf.frames.push((off.clamp(0.0, 1.0), decls.clone()));
            }
        }
        i = end + 1;
    }
    kf.frames
        .sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    kf
}

fn ident_end(s: &str, from: usize) -> usize {
    s[from..]
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .map(|n| from + n)
        .unwrap_or(s.len())
}

fn unquote(s: &str) -> &str {
    let s = s.trim();
    if s.len() >= 2
        && ((s.starts_with('\'') && s.ends_with('\'')) || (s.starts_with('"') && s.ends_with('"')))
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

fn parse_attr(inner: &str) -> Result<AttrSel, String> {
    let ops = ["^=", "$=", "*=", "~=", "|=", "="];
    for op in ops {
        if let Some(at) = inner.find(op) {
            let name = inner[..at].trim().to_ascii_lowercase();
            let value: Arc<str> = Arc::from(unquote(&inner[at + op.len()..]));
            let op = match op {
                "^=" => AttrOp::Prefix(value),
                "$=" => AttrOp::Suffix(value),
                "*=" => AttrOp::Contains(value),
                "~=" => AttrOp::Word(value),
                "|=" => AttrOp::Dash(value),
                _ => AttrOp::Eq(value),
            };
            return Ok(AttrSel {
                name: Arc::from(name.as_str()),
                op,
            });
        }
    }
    let name = inner.trim().to_ascii_lowercase();
    if name.is_empty() {
        return Err("empty attribute selector".into());
    }
    Ok(AttrSel {
        name: Arc::from(name.as_str()),
        op: AttrOp::Exists,
    })
}

fn state_of(name: &str) -> Option<State> {
    Some(match name {
        "hover" => State::Hover,
        "active" => State::Active,
        "focus" | "focus-within" | "focus-visible" => State::Focus,
        "disabled" => State::Disabled,
        _ => return None,
    })
}

fn parse_selector(s: &str) -> Result<Selector, String> {
    if s.is_empty() {
        return Err("empty selector".into());
    }
    let mut compounds: Vec<(Combinator, Compound)> = Vec::new();
    let mut cur = Compound::default();
    let mut cur_started = false;
    let mut comb = Combinator::Descendant;
    let mut part: Option<Arc<str>> = None;
    let mut pseudo: Option<PseudoElement> = None;
    let mut part_states = Vec::new();
    let mut spec = (0u32, 0u32, 0u32);
    let b = s.as_bytes();
    let mut i = 0;
    let after_part = |part: &Option<Arc<str>>, pseudo: &Option<PseudoElement>| -> bool {
        part.is_some() || pseudo.is_some()
    };
    while i < b.len() {
        let c = b[i];
        match c {
            b' ' | b'\t' | b'\n' | b'\r' | b'>' => {
                // Combinator: whitespace and/or `>`.
                let mut j = i;
                let mut child = false;
                while j < b.len() && matches!(b[j], b' ' | b'\t' | b'\n' | b'\r' | b'>') {
                    child |= b[j] == b'>';
                    j += 1;
                }
                if j >= b.len() {
                    break;
                }
                if after_part(&part, &pseudo) {
                    return Err("a combinator after a part or pseudo-element".into());
                }
                if cur_started {
                    compounds.push((comb, std::mem::take(&mut cur)));
                    cur_started = false;
                }
                comb = if child {
                    Combinator::Child
                } else {
                    Combinator::Descendant
                };
                i = j;
            }
            b'*' => {
                cur_started = true;
                i += 1;
            }
            b'[' => {
                let end = find_top(s, i + 1, b"]").ok_or("unclosed attribute selector")?;
                if after_part(&part, &pseudo) {
                    return Err("an attribute after a part".into());
                }
                cur.attrs.push(parse_attr(&s[i + 1..end])?);
                spec.1 += 1;
                cur_started = true;
                i = end + 1;
            }
            b':' => {
                let double = b.get(i + 1) == Some(&b':');
                let start = if double { i + 2 } else { i + 1 };
                let end = ident_end(s, start);
                let name = s[start..end].to_ascii_lowercase();
                let mut next = end;
                let arg = if b.get(end) == Some(&b'(') {
                    let close = find_top(s, end + 1, b")").ok_or("unclosed pseudo argument")?;
                    next = close + 1;
                    Some(s[end + 1..close].trim())
                } else {
                    None
                };
                match (double, name.as_str(), arg) {
                    (true, "part", Some(arg)) => {
                        if part.is_some() || pseudo.is_some() {
                            return Err("a second ::part".into());
                        }
                        if arg.contains(char::is_whitespace) {
                            return Err("::part with several names".into());
                        }
                        part = Some(Arc::from(arg));
                        spec.2 += 1;
                    }
                    (_, "before" | "after", None) => {
                        if pseudo.is_some() {
                            return Err("a second pseudo-element".into());
                        }
                        pseudo = Some(if name == "before" {
                            PseudoElement::Before
                        } else {
                            PseudoElement::After
                        });
                        spec.2 += 1;
                    }
                    (false, n, None) if state_of(n).is_some() => {
                        if pseudo.is_some() {
                            return Err("a state after a pseudo-element".into());
                        }
                        let st = state_of(n).unwrap();
                        if part.is_some() {
                            part_states.push(st);
                        } else {
                            cur.states.push(st);
                        }
                        spec.1 += 1;
                    }
                    _ => return Err(format!("unsupported pseudo `{}`", &s[i..next])),
                }
                cur_started = true;
                i = next;
            }
            b'.' => return Err("class selectors are not read".into()),
            b'#' => return Err("id selectors are not read".into()),
            c if c.is_ascii_alphabetic() || c == b'-' || c == b'_' => {
                if cur_started {
                    return Err(format!("unexpected `{}`", &s[i..]));
                }
                let end = ident_end(s, i);
                cur.ty = Some(Arc::from(s[i..end].to_ascii_lowercase().as_str()));
                spec.2 += 1;
                cur_started = true;
                i = end;
            }
            _ => return Err(format!("unexpected `{}`", c as char)),
        }
    }
    if cur_started {
        compounds.push((comb, cur));
    }
    if compounds.is_empty() {
        return Err("no compound".into());
    }
    // States on an ancestor compound would need the ancestor's state.
    if compounds[..compounds.len() - 1]
        .iter()
        .any(|(_, c)| !c.states.is_empty())
    {
        return Err("a state on an ancestor compound".into());
    }
    Ok(Selector {
        compounds,
        part,
        pseudo,
        part_states,
        specificity: spec,
    })
}

// ── matching ───────────────────────────────────────────────────────────────

fn attr_matches(a: &AttrSel, el: &Element) -> bool {
    let Some(v) = (el.attr)(&a.name) else {
        return false;
    };
    match &a.op {
        AttrOp::Exists => true,
        AttrOp::Eq(x) => v.as_ref() == x.as_ref(),
        AttrOp::Prefix(x) => !x.is_empty() && v.starts_with(x.as_ref()),
        AttrOp::Suffix(x) => !x.is_empty() && v.ends_with(x.as_ref()),
        AttrOp::Contains(x) => !x.is_empty() && v.contains(x.as_ref()),
        AttrOp::Word(x) => v.split_whitespace().any(|w| w == x.as_ref()),
        AttrOp::Dash(x) => v.as_ref() == x.as_ref() || v.starts_with(&format!("{x}-")),
    }
}

fn compound_matches(c: &Compound, el: &Element) -> bool {
    if let Some(ty) = &c.ty {
        if !el.ty.eq_ignore_ascii_case(ty) {
            return false;
        }
    }
    c.attrs.iter().all(|a| attr_matches(a, el))
}

fn selector_matches(sel: &Selector, q: &Query) -> bool {
    if sel.part.as_deref() != q.part || sel.pseudo != q.pseudo {
        return false;
    }
    let (subject, rest) = sel.compounds.split_last().unwrap();
    if !compound_matches(&subject.1, q.element) {
        return false;
    }
    // Right to left over the ancestors; descendant backtracks greedily
    // (the shallow chains themes write make that exact enough).
    let mut anc = 0usize;
    let mut comb = subject.0;
    for (c_comb, c) in rest.iter().rev() {
        match comb {
            Combinator::Child => {
                if anc >= q.ancestors.len() || !compound_matches(c, &q.ancestors[anc]) {
                    return false;
                }
                anc += 1;
            }
            Combinator::Descendant => {
                let Some(found) = q.ancestors[anc..]
                    .iter()
                    .position(|a| compound_matches(c, a))
                else {
                    return false;
                };
                anc += found + 1;
            }
        }
        comb = *c_comb;
    }
    true
}

// ── animation ──────────────────────────────────────────────────────────────

/// `animation-*` on an element, resolved from the cascade.
#[derive(Debug, Clone, PartialEq)]
pub struct Animation {
    pub name: Arc<str>,
    pub duration_ms: f32,
    pub delay_ms: f32,
    /// `None` is `infinite`.
    pub iterations: Option<f32>,
    pub direction: AnimDirection,
    pub easing: crate::transition::Easing,
    pub keyframes: Arc<Keyframes>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnimDirection {
    Normal,
    Reverse,
    Alternate,
    AlternateReverse,
}

fn parse_ms(s: &str) -> Option<f32> {
    let s = s.trim();
    if let Some(n) = s.strip_suffix("ms") {
        n.trim().parse().ok()
    } else if let Some(n) = s.strip_suffix('s') {
        n.trim().parse::<f32>().ok().map(|v| v * 1000.0)
    } else {
        None
    }
}

/// Pull the `animation*` declarations out of `c` (so the evaluator never
/// sees them) and resolve them against `sheet`'s keyframes. `None` when
/// no named animation with a duration applies.
pub fn take_animation(c: &mut Cascaded, sheet: &Stylesheet) -> Option<Animation> {
    let keys: Vec<Arc<str>> = c
        .normal
        .keys()
        .chain(c.important.keys())
        .filter(|k| k.starts_with("animation"))
        .cloned()
        .collect();
    let mut name: Option<String> = None;
    let mut duration = 0.0f32;
    let mut delay = 0.0f32;
    let mut iterations = Some(1.0f32);
    let mut direction = AnimDirection::Normal;
    let mut easing = crate::transition::Easing::Ease;
    let mut short = None;
    let mut longs = Vec::new();
    for k in keys {
        if let Some(v) = c.take(&k) {
            if k.as_ref() == "animation" {
                short = Some(v);
            } else {
                longs.push((k, v));
            }
        }
    }
    let mut apply = |prop: &str, v: &str| match prop {
        "animation-name" => name = Some(v.trim().to_string()),
        "animation-duration" => duration = parse_ms(v).unwrap_or(0.0),
        "animation-delay" => delay = parse_ms(v).unwrap_or(0.0),
        "animation-iteration-count" => {
            iterations = if v.trim() == "infinite" {
                None
            } else {
                v.trim().parse().ok()
            }
        }
        "animation-direction" => {
            direction = match v.trim() {
                "reverse" => AnimDirection::Reverse,
                "alternate" => AnimDirection::Alternate,
                "alternate-reverse" => AnimDirection::AlternateReverse,
                _ => AnimDirection::Normal,
            }
        }
        "animation-timing-function" => {
            easing = crate::transition::parse_easing_text(v.trim())
                .unwrap_or(crate::transition::Easing::Ease)
        }
        _ => {}
    };
    if let Some(s) = short {
        // `animation: name 3s ease-out infinite reverse` — any order; the
        // first time is the duration, the second the delay.
        let mut times = 0;
        for tok in s.split_whitespace() {
            if parse_ms(tok).is_some() {
                apply(
                    if times == 0 {
                        "animation-duration"
                    } else {
                        "animation-delay"
                    },
                    tok,
                );
                times += 1;
            } else if tok == "infinite" || tok.parse::<f32>().is_ok() {
                apply("animation-iteration-count", tok);
            } else if matches!(
                tok,
                "normal" | "reverse" | "alternate" | "alternate-reverse"
            ) {
                apply("animation-direction", tok);
            } else if crate::transition::parse_easing_text(tok).is_some() {
                apply("animation-timing-function", tok);
            } else {
                apply("animation-name", tok);
            }
        }
    }
    for (k, v) in &longs {
        apply(k, v);
    }
    let name = name.filter(|n| n != "none")?;
    let keyframes = sheet.keyframes.get(name.as_str())?;
    if duration <= 0.0 {
        return None;
    }
    Some(Animation {
        name: Arc::from(name.as_str()),
        duration_ms: duration,
        delay_ms: delay,
        iterations,
        direction,
        easing,
        keyframes: Arc::new(keyframes.clone()),
    })
}

impl Animation {
    /// The keyframe progress (`0..=1`, direction applied) at `t_ms` since
    /// the animation started — `None` before it starts or after a finite
    /// run ends (`animation-fill-mode: none`).
    pub fn progress(&self, t_ms: f32) -> Option<f32> {
        let t = t_ms - self.delay_ms;
        if t < 0.0 {
            return None;
        }
        let iter_f = t / self.duration_ms;
        if let Some(n) = self.iterations {
            if iter_f >= n {
                return None;
            }
        }
        let iter = iter_f.floor();
        let p = iter_f - iter;
        let odd = (iter as i64) % 2 == 1;
        Some(match self.direction {
            AnimDirection::Normal => p,
            AnimDirection::Reverse => 1.0 - p,
            AnimDirection::Alternate => {
                if odd {
                    1.0 - p
                } else {
                    p
                }
            }
            AnimDirection::AlternateReverse => {
                if odd {
                    p
                } else {
                    1.0 - p
                }
            }
        })
    }

    /// Every animated property's value at `t_ms`. `base` is the element's
    /// own value for a property, used where the keyframes leave an end
    /// implicit; a pair that cannot interpolate flips at the interval's
    /// midpoint, as CSS's discrete animation does.
    pub fn sample(&self, t_ms: f32, base: &dyn Fn(&str) -> Option<String>) -> Decls {
        let mut out = Decls::new();
        let Some(q) = self.progress(t_ms) else {
            return out;
        };
        let mut props: Vec<Arc<str>> = Vec::new();
        for (_, decls) in &self.keyframes.frames {
            for d in decls {
                if !props.contains(&d.prop) {
                    props.push(d.prop.clone());
                }
            }
        }
        for prop in props {
            let mut frames: Vec<(f32, String)> = self
                .keyframes
                .frames
                .iter()
                .filter_map(|(o, ds)| {
                    ds.iter()
                        .rev()
                        .find(|d| d.prop == prop)
                        .map(|d| (*o, d.value.to_string()))
                })
                .collect();
            let base_v = base(&prop);
            if frames.first().is_none_or(|f| f.0 > 0.0) {
                frames.insert(0, (0.0, base_v.clone().unwrap_or_default()));
            }
            if frames.last().is_none_or(|f| f.0 < 1.0) {
                frames.push((1.0, base_v.unwrap_or_default()));
            }
            let idx = frames
                .windows(2)
                .position(|w| q >= w[0].0 && q <= w[1].0)
                .unwrap_or(0);
            let (a, b) = (&frames[idx], &frames[(idx + 1).min(frames.len() - 1)]);
            let span = b.0 - a.0;
            let lin = if span > 0.0 { (q - a.0) / span } else { 1.0 };
            let x = crate::transition::ease(&self.easing, lin.clamp(0.0, 1.0));
            let v = interpolate(&a.1, &b.1, x).unwrap_or_else(|| {
                if lin < 0.5 {
                    a.1.clone()
                } else {
                    b.1.clone()
                }
            });
            if !v.is_empty() {
                out.insert(prop, DeclValue::Text(Arc::from(v.as_str())));
            }
        }
        out
    }
}

/// Split into numbers and the text between them: `skew(-15deg)` →
/// `["skew(", "deg)"]` + `[-15]`.
fn numbers(s: &str) -> (Vec<String>, Vec<f32>) {
    let mut texts = vec![String::new()];
    let mut nums = Vec::new();
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        let starts_num = c.is_ascii_digit()
            || (c == b'.' && b.get(i + 1).is_some_and(|d| d.is_ascii_digit()))
            || ((c == b'-' || c == b'+')
                && b.get(i + 1)
                    .is_some_and(|d| d.is_ascii_digit() || *d == b'.')
                && (i == 0 || !b[i - 1].is_ascii_alphanumeric()));
        let in_ident = i > 0 && (b[i - 1].is_ascii_alphabetic() || b[i - 1] == b'-');
        if starts_num && !(in_ident && c.is_ascii_digit()) {
            let mut j = i + 1;
            while j < b.len() && (b[j].is_ascii_digit() || b[j] == b'.') {
                j += 1;
            }
            if let Ok(n) = s[i..j].parse::<f32>() {
                nums.push(n);
                texts.push(String::new());
                i = j;
                continue;
            }
        }
        texts.last_mut().unwrap().push(c as char);
        i += 1;
    }
    (texts, nums)
}

/// Linear interpolation between two values of the same shape — the same
/// text with different numbers in it. `None` when the shapes differ.
pub fn interpolate(a: &str, b: &str, x: f32) -> Option<String> {
    let (ta, na) = numbers(a.trim());
    let (tb, nb) = numbers(b.trim());
    if ta != tb || na.len() != nb.len() || na.is_empty() {
        return if a.trim() == b.trim() {
            Some(a.trim().to_string())
        } else {
            None
        };
    }
    let mut out = String::new();
    for (i, t) in ta.iter().enumerate() {
        out.push_str(t);
        if i < na.len() {
            let v = na[i] + (nb[i] - na[i]) * x;
            let v = (v * 10000.0).round() / 10000.0;
            out.push_str(&format!("{v}"));
        }
    }
    Some(out)
}

/// `skew(x)`/`skewX(x)`/`skewY(y)` in a transform's text → degrees
/// `(x, y)`; `None` when the text has no skew.
pub fn skew_deg(transform: &str) -> Option<(f32, f32)> {
    let mut found = false;
    let (mut x, mut y) = (0.0, 0.0);
    let deg = |s: &str| -> f32 {
        let s = s.trim();
        if let Some(n) = s.strip_suffix("deg") {
            n.trim().parse().unwrap_or(0.0)
        } else if let Some(n) = s.strip_suffix("rad") {
            n.trim().parse::<f32>().unwrap_or(0.0).to_degrees()
        } else if let Some(n) = s.strip_suffix("turn") {
            n.trim().parse::<f32>().unwrap_or(0.0) * 360.0
        } else {
            s.parse().unwrap_or(0.0)
        }
    };
    let lower = transform.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(at) = rest.find("skew") {
        let tail = &rest[at + 4..];
        let (kind, tail) = if let Some(t) = tail.strip_prefix('x') {
            ('x', t)
        } else if let Some(t) = tail.strip_prefix('y') {
            ('y', t)
        } else {
            ('b', tail)
        };
        let Some(open) = tail.find('(') else { break };
        let Some(close) = tail[open..].find(')') else {
            break;
        };
        let args: Vec<&str> = tail[open + 1..open + close].split(',').collect();
        found = true;
        match kind {
            'x' => x += deg(args[0]),
            'y' => y += deg(args[0]),
            _ => {
                x += deg(args[0]);
                if let Some(a) = args.get(1) {
                    y += deg(a);
                }
            }
        }
        rest = &tail[open + close..];
    }
    found.then_some((x, y))
}

// ── the shipped themes ─────────────────────────────────────────────────────

/// The `index.css` each built-in theme ships, as written — the web's own
/// files, read at build time so a change there reaches the renderer with
/// no Rust edit.
pub fn builtin_css(theme: &str) -> Option<&'static str> {
    Some(match theme {
        "light" => include_str!("../../../../packages/design-system/2-themes/src/light/index.css"),
        "dark" => include_str!("../../../../packages/design-system/2-themes/src/dark/index.css"),
        "black" => include_str!("../../../../packages/design-system/2-themes/src/black/index.css"),
        "retro" => include_str!("../../../../packages/design-system/2-themes/src/retro/index.css"),
        "cyberpunk" => {
            include_str!("../../../../packages/design-system/2-themes/src/cyberpunk/index.css")
        }
        _ => return None,
    })
}

/// The parsed sheet of a built-in theme, parsed once.
pub fn builtin(theme: &str) -> Option<&'static Stylesheet> {
    use std::sync::LazyLock;
    static SHEETS: LazyLock<IndexMap<&'static str, Stylesheet>> = LazyLock::new(|| {
        ["light", "dark", "black", "retro", "cyberpunk"]
            .into_iter()
            .map(|t| (t, Stylesheet::parse(builtin_css(t).unwrap())))
            .collect()
    });
    SHEETS.get(theme)
}

/// Sheets installed at runtime — a user-edited theme's `css`, a bundle
/// theme's — by theme id. They take precedence over a built-in sheet of
/// the same id.
static INSTALLED: std::sync::LazyLock<std::sync::RwLock<IndexMap<Arc<str>, Arc<Stylesheet>>>> =
    std::sync::LazyLock::new(Default::default);

/// Install `css` as `theme`'s stylesheet (replacing any earlier one).
/// Returns what was skipped, so a theme editor can say which rules the
/// renderer does not read.
pub fn install(theme: &str, css: &str) -> Vec<String> {
    let sheet = Stylesheet::parse(css);
    let skipped = sheet.skipped.clone();
    if let Ok(mut map) = INSTALLED.write() {
        map.insert(Arc::from(theme), Arc::new(sheet));
    }
    skipped
}

/// Drop an installed sheet; a built-in theme falls back to its own.
pub fn uninstall(theme: &str) {
    if let Ok(mut map) = INSTALLED.write() {
        map.shift_remove(theme);
    }
}

/// The sheet `theme` paints with — installed first, else built in.
pub fn for_theme(theme: &str) -> Option<Arc<Stylesheet>> {
    if let Some(s) = INSTALLED.read().ok().and_then(|m| m.get(theme).cloned()) {
        return Some(s);
    }
    use std::sync::LazyLock;
    static ARCS: LazyLock<IndexMap<&'static str, Arc<Stylesheet>>> = LazyLock::new(|| {
        ["light", "dark", "black", "retro", "cyberpunk"]
            .into_iter()
            .map(|t| (t, Arc::new(builtin(t).unwrap().clone())))
            .collect()
    });
    ARCS.get(theme).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn el<'a>(ty: &'a str, attr: &'a dyn Fn(&str) -> Option<Arc<str>>) -> Element<'a> {
        Element { ty, attr }
    }

    fn none(_: &str) -> Option<Arc<str>> {
        None
    }

    fn theme_root(theme: &'static str) -> impl Fn(&str) -> Option<Arc<str>> {
        move |n: &str| (n == "data-we-theme").then(|| Arc::from(theme))
    }

    #[test]
    fn shipped_sheets_parse_with_nothing_skipped() {
        for t in ["light", "dark", "black", "retro", "cyberpunk"] {
            let sheet = Stylesheet::parse(builtin_css(t).unwrap());
            println!(
                "{t}: {} rules, {} keyframes, {} skipped {:?}",
                sheet.rules.len(),
                sheet.keyframes.len(),
                sheet.skipped.len(),
                sheet.skipped
            );
            assert!(sheet.skipped.is_empty(), "{t}: {:?}", sheet.skipped);
        }
        let cp = builtin("cyberpunk").unwrap();
        assert_eq!(cp.rules.len(), 9);
        assert_eq!(cp.keyframes["glitched"].frames.len(), 8);
        assert_eq!(builtin("retro").unwrap().rules.len(), 21);
    }

    #[test]
    fn unsupported_is_skipped_and_counted() {
        let sheet = Stylesheet::parse(
            "@import url(x.css); .a { color: red } @media (min-width: 1px) { b { c: d } } \
             a:not(.b) { color: red } we-text { color: blue } @font-face { font-family: x } \
             @scope (.t) { we-icon { color: green } } garbage",
        );
        assert_eq!(sheet.rules.len(), 2, "{:?}", sheet.rules);
        assert_eq!(sheet.skipped.len(), 6, "{:?}", sheet.skipped);
    }

    #[test]
    fn decls_keep_data_urls_and_important() {
        let d = parse_decls(
            "background: url(\"data:image/svg+xml;charset=utf-8,%3Csvg\"); color: #222 !important",
        );
        assert_eq!(d.len(), 2);
        assert!(d[0].value.contains("charset=utf-8"));
        assert!(d[1].important);
        assert_eq!(d[1].value.as_ref(), "#222");
    }

    #[test]
    fn heading_prefix_matches_headings_only() {
        let sheet = builtin("cyberpunk").unwrap();
        let root_attr = theme_root("cyberpunk");
        let root = el("div", &root_attr);
        for (variant, hit) in [
            ("heading-sm", true),
            ("heading-md", true),
            ("heading-lg", true),
            ("heading-xl", true),
            ("heading", true),
            ("body", false),
            ("label", false),
            ("subheading", false),
        ] {
            let attr = move |n: &str| (n == "variant").then(|| Arc::from(variant));
            let text = el("we-text", &attr);
            let q = Query {
                element: &text,
                ancestors: std::slice::from_ref(&root),
                part: None,
                pseudo: None,
            };
            let c = cascade(&sheet.matching(&q), None);
            assert_eq!(c.get("display").is_some(), hit, "{variant}");
        }
    }

    #[test]
    fn theme_gate_needs_the_ancestor() {
        let sheet = builtin("retro").unwrap();
        let button = el("we-button", &none);
        let other_attr = theme_root("cyberpunk");
        let other = el("div", &other_attr);
        for ancestors in [&[][..], std::slice::from_ref(&other)] {
            let q = Query {
                element: &button,
                ancestors,
                part: Some("base"),
                pseudo: None,
            };
            assert!(sheet.matching(&q).is_empty());
        }
    }

    #[test]
    fn specificity_then_order() {
        let sheet = Stylesheet::parse(
            "[t='x'] we-button[square]::part(base) { border-radius: 0 }\n\
             [t='x'] we-button::part(base) { border-radius: 4px; color: red }\n\
             [t='x'] we-button::part(base) { color: blue }\n\
             we-button::part(base) { color: green !important }\n\
             we-button::part(base) { color: black !important }",
        );
        let root_attr = |n: &str| (n == "t").then(|| Arc::from("x"));
        let root = el("div", &root_attr);
        let sq = |n: &str| (n == "square").then(|| Arc::from(""));
        let button = el("we-button", &sq);
        let q = Query {
            element: &button,
            ancestors: std::slice::from_ref(&root),
            part: Some("base"),
            pseudo: None,
        };
        let c = cascade(&sheet.matching(&q), None);
        // The attribute raises specificity over the later, plainer rule.
        assert_eq!(c.get("border-radius").as_deref(), Some("0"));
        // Important beats every normal value; among importants, the later.
        assert_eq!(c.get("color").as_deref(), Some("black"));
        assert_eq!(c.normal["color"].text(), "blue");
        let plain = el("we-button", &none);
        let q = Query {
            element: &plain,
            ..q
        };
        let c = cascade(&sheet.matching(&q), None);
        assert_eq!(c.get("border-radius").as_deref(), Some("4px"));
    }

    #[test]
    fn states_only_apply_in_their_state() {
        let sheet = builtin("retro").unwrap();
        let root_attr = theme_root("retro");
        let root = el("div", &root_attr);
        let button = el("we-button", &none);
        let q = Query {
            element: &button,
            ancestors: std::slice::from_ref(&root),
            part: Some("base"),
            pseudo: None,
        };
        let m = sheet.matching(&q);
        let rest = cascade(&m, None);
        let active = cascade(&m, Some(State::Active));
        assert!(rest
            .get("box-shadow")
            .unwrap()
            .starts_with("inset -1px -1px #0a0a0a"));
        assert!(active
            .get("box-shadow")
            .unwrap()
            .starts_with("inset -1px -1px #fff"));
        assert!(has_state(&m, State::Active));
        assert!(!has_state(&m, State::Hover));
    }

    #[test]
    fn child_and_descendant_combinators() {
        let sheet = Stylesheet::parse("a > b c { x: 1 } a c { y: 2 }");
        let a = el("a", &none);
        let b = el("b", &none);
        let d = el("d", &none);
        let c = el("c", &none);
        let q = |anc: &[Element]| {
            let q = Query {
                element: &c,
                ancestors: anc,
                part: None,
                pseudo: None,
            };
            cascade(&sheet.matching(&q), None)
        };
        let hit = q(&[el("b", &none), el("a", &none)]);
        assert_eq!(hit.get("x").as_deref(), Some("1"));
        let miss = q(&[b, d, a]);
        assert_eq!(miss.get("x"), None);
        assert_eq!(miss.get("y").as_deref(), Some("2"));
    }

    fn glitch(direction: &str) -> Animation {
        let sheet = builtin("cyberpunk").unwrap();
        let mut c = Cascaded::default();
        for (k, v) in [
            ("animation-name", "glitched"),
            ("animation-duration", "3s"),
            ("animation-iteration-count", "infinite"),
            ("animation-direction", direction),
            ("animation-timing-function", "ease-out"),
        ] {
            c.normal.insert(Arc::from(k), DeclValue::Text(Arc::from(v)));
        }
        let a = take_animation(&mut c, sheet).unwrap();
        assert!(c.is_empty(), "animation decls are taken out");
        a
    }

    fn skew_at(a: &Animation, t: f32) -> f32 {
        let d = a.sample(t, &|_| None);
        skew_deg(&d["transform"].text()).unwrap().0
    }

    #[test]
    fn glitch_keyframes_sample_by_direction() {
        let fwd = glitch("normal");
        assert_eq!(skew_at(&fwd, 0.0), -15.0);
        assert_eq!(skew_at(&fwd, 0.55 * 3000.0), 5.0);
        assert_eq!(skew_at(&fwd, 0.3 * 3000.0), 0.0);
        // `reverse` plays the keyframes backwards: t=0 is the 100% frame,
        // and the +5° band (51–59%) arrives at 41–49% of the run.
        let rev = glitch("reverse");
        assert_eq!(rev.direction, AnimDirection::Reverse);
        assert_eq!(skew_at(&rev, 0.0), 0.0);
        assert_eq!(skew_at(&rev, 0.45 * 3000.0), 5.0);
        assert_eq!(skew_at(&rev, 0.95 * 3000.0), -15.0);
        // Infinite: the next iteration repeats.
        assert_eq!(skew_at(&rev, 3000.0 + 0.95 * 3000.0), -15.0);
        // `left` interpolates where both ends are lengths.
        let d = fwd.sample(0.105 * 3000.0, &|_| None);
        let left: f32 = d["left"].text().trim_end_matches("px").parse().unwrap();
        assert!(left > -4.0 && left < 2.0, "{left}");
    }

    #[test]
    fn finite_animation_ends() {
        let mut a = glitch("normal");
        a.iterations = Some(1.0);
        assert!(a.progress(2999.0).is_some());
        assert!(a.progress(3001.0).is_none());
    }

    #[test]
    fn interpolate_shapes() {
        assert_eq!(
            interpolate("skew(-15deg)", "skew(5deg)", 0.5).as_deref(),
            Some("skew(-5deg)")
        );
        assert_eq!(interpolate("-4px", "2px", 0.5).as_deref(), Some("-1px"));
        assert_eq!(interpolate("auto", "2px", 0.5), None);
    }

    #[test]
    fn skew_parsing() {
        assert_eq!(skew_deg("skew(-15deg)"), Some((-15.0, 0.0)));
        assert_eq!(skew_deg("translateX(2px) skewY(3deg)"), Some((0.0, 3.0)));
        assert_eq!(skew_deg("rotate(3deg)"), None);
    }
}
