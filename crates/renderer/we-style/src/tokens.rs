//! `TokenTable`: one theme's computed custom properties — the `vars` map the
//! conformance recorder captured in the browser (`tokens/<theme>.json`), the
//! same map `styleResolve.ts`'s `substituteVars` resolves against.
//!
//! Substitution is textual and bounded, exactly as the TypeScript does it:
//! `var(--we-*)` names are replaced by their table value, a `var(--we-*, fb)`
//! with an undeclared name by its fallback, and an undeclared `var(--we-*)`
//! with no fallback is left in place — the guaranteed-invalid marker CSS
//! itself uses, which makes the declaration paint nothing. At most eight
//! rounds, matching `substituteVars`.

use std::sync::Arc;

use indexmap::IndexMap;

/// A theme's computed `--we-*` values, custom-property name → value text.
#[derive(Debug, Clone, Default)]
pub struct TokenTable {
    vars: IndexMap<Arc<str>, Arc<str>>,
}

impl TokenTable {
    pub fn new(vars: IndexMap<Arc<str>, Arc<str>>) -> Self {
        Self { vars }
    }

    /// Parse a recorded table: `{ "theme": "dark", "vars": { "--we-…": "…" } }`.
    pub fn from_json(json: &serde_json::Value) -> Result<Self, TokenTableError> {
        let vars = json
            .get("vars")
            .and_then(|v| v.as_object())
            .ok_or(TokenTableError::MissingVars)?;
        let mut out = IndexMap::with_capacity(vars.len());
        for (k, v) in vars {
            let value = v
                .as_str()
                .ok_or_else(|| TokenTableError::NonString(k.clone()))?;
            out.insert(Arc::from(k.as_str()), Arc::from(value));
        }
        Ok(Self { vars: out })
    }

    /// The computed text a `--we-*` custom property holds, if this table
    /// declares it.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.vars.get(name).map(|v| v.as_ref())
    }

    pub fn contains(&self, name: &str) -> bool {
        self.vars.contains_key(name)
    }

    pub fn len(&self) -> usize {
        self.vars.len()
    }

    pub fn is_empty(&self) -> bool {
        self.vars.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&Arc<str>, &Arc<str>)> {
        self.vars.iter()
    }

    /// `var(--we-*[ , fallback])` resolved against this table — the port of
    /// `substituteVars` in `conformance/src/styleResolve.ts`: at most eight
    /// rounds, a declared name replaced verbatim, an undeclared name replaced
    /// by its fallback (or left as the whole `var(…)` when there is none).
    ///
    /// The replacement is textual and shallow: a nested `var(--a, var(--b))`
    /// captures ` var(--b` as the fallback (the regex's `[^)]*` stops at the
    /// first `)`), leaving the outer `)` to re-parse next round. The vectors
    /// record this exact behaviour — `var(--we-theme-x, var(--we-y))` under a
    /// theme that declares `x` computes to `<x's value>)` with a stray paren.
    pub fn substitute(&self, css: &str) -> Arc<str> {
        let mut out = css.to_string();
        for _ in 0..8 {
            let next = substitute_once(&out, self);
            if next == out {
                break;
            }
            out = next;
        }
        Arc::from(out.as_str())
    }

    /// `var()` resolved the way a browser does it — parentheses balanced, a
    /// fallback's own `var()`s honoured recursively. [`substitute`] is the
    /// *recorded* simulation (shallow, stray-paren artefacts and all); this is
    /// the *evaluation* view: `var(--we-theme-control-radius,
    /// var(--we-radius-400))` under glow computes to `999px`, not `999px)`.
    /// Bounded at eight levels of nesting — recorded table values carry no
    /// `var()`s, so depth only comes from authored text.
    pub fn substitute_nested(&self, css: &str) -> Arc<str> {
        Arc::from(substitute_nested_at(css, self, 0).as_str())
    }
}

/// One balanced pass of [`TokenTable::substitute_nested`]. Non-`--we-*` vars
/// are skipped at their `var(` (the scan still recurses *inside*, so
/// `var(--page-x, var(--we-y))` still resolves `--we-y`).
fn substitute_nested_at(css: &str, vars: &TokenTable, depth: u8) -> String {
    if depth >= 8 {
        return css.to_string();
    }
    let bytes = css.as_bytes();
    let mut out = String::with_capacity(css.len());
    let mut i = 0usize;
    let mut last = 0usize;
    while i + 4 < bytes.len() {
        if &bytes[i..i + 4] != b"var(" {
            i += 1;
            continue;
        }
        // The whole `var(…)` span — balanced parens, not the first `)`. The
        // opener was already consumed: depth starts at 1, the match ends at 0.
        let mut depth_p = 1i32;
        let mut j = i + 4;
        while j < bytes.len() {
            match bytes[j] {
                b'(' => depth_p += 1,
                b')' => {
                    depth_p -= 1;
                    if depth_p == 0 {
                        break;
                    }
                }
                _ => {}
            }
            j += 1;
        }
        if j >= bytes.len() {
            break; // unbalanced — leave the rest verbatim
        }
        let (name, fallback) = split_var_args(&css[i + 4..j]);
        if !name.starts_with("--we-") {
            i += 4;
            continue;
        }
        let replacement = if let Some(v) = vars.get(name) {
            substitute_nested_at(v, vars, depth + 1)
        } else if let Some(fb) = fallback {
            substitute_nested_at(fb, vars, depth + 1)
        } else {
            css[i..=j].to_string()
        };
        out.push_str(&css[last..i]);
        out.push_str(&replacement);
        last = j + 1;
        i = j + 1;
    }
    out.push_str(&css[last..]);
    out
}

/// `name, fallback` of a `var()`'s argument list — the comma counts only at
/// paren depth 0, so `var(--a, var(--b))` splits as `--a` / `var(--b)`.
fn split_var_args(inner: &str) -> (&str, Option<&str>) {
    let mut depth = 0i32;
    for (i, ch) in inner.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                return (inner[..i].trim(), Some(inner[i + 1..].trim()));
            }
            _ => {}
        }
    }
    (inner.trim(), None)
}

/// One substitution round — the `VAR_RE` of the TypeScript, hand-written:
/// `var\(\s*(--we-[\w-]+)\s*(?:,\s*([^)]*))?\)`.
fn substitute_once(css: &str, vars: &TokenTable) -> String {
    let bytes = css.as_bytes();
    let mut out = String::with_capacity(css.len());
    let mut i = 0usize;
    let mut last = 0usize;
    while i + 4 < bytes.len() {
        if &bytes[i..i + 4] != b"var(" {
            i += 1;
            continue;
        }
        // `var(` — parse `\s*--we-[\w-]+\s*(,\s*[^)]*)?\)`.
        let mut j = i + 4;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        let name_start = j;
        while j < bytes.len()
            && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'-')
        {
            j += 1;
        }
        let name = &css[name_start..j];
        if !name.starts_with("--we-") {
            i += 4;
            continue;
        }
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        let mut fallback: Option<&str> = None;
        if j < bytes.len() && bytes[j] == b',' {
            j += 1;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            let fb_start = j;
            while j < bytes.len() && bytes[j] != b')' {
                j += 1;
            }
            fallback = Some(css[fb_start..j].trim());
        }
        if j >= bytes.len() || bytes[j] != b')' {
            i += 4;
            continue;
        }
        j += 1; // past `)`
        let replacement = if let Some(v) = vars.get(name) {
            v.to_string()
        } else if let Some(fb) = fallback {
            fb.to_string()
        } else {
            css[i..j].to_string()
        };
        out.push_str(&css[last..i]);
        out.push_str(&replacement);
        last = j;
        i = j;
    }
    out.push_str(&css[last..]);
    out
}

/// Ways a recorded table can fail to load.
#[derive(Debug, thiserror::Error)]
pub enum TokenTableError {
    #[error("token table has no `vars` object")]
    MissingVars,
    #[error("token table var `{0}` is not a string")]
    NonString(String),
}
