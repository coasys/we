//! `we-style`: design-system props → [`Style`] — tokens, the five presets and
//! the bundle's `glow` theme. Filled in by task E4; the [`Style`] name exists
//! now because the widget contract paints and measures against it.
//!
//! No egui, no I/O, no tokio: this crate builds for `wasm32-unknown-unknown`.
#![forbid(unsafe_code)]

/// The concrete values a widget measures and paints with — what the
/// design-system props on a node resolve to under the active theme. E4 gives
/// it fields (spacing, roles, radii, text); until then it is the empty style
/// every widget must still accept.
#[derive(Debug, Clone, Default)]
pub struct Style;

impl Style {
    /// The style a widget gets when nothing resolved — every prop absent.
    pub fn empty() -> Self {
        Style
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder() {
        let _style = Style::empty();
    }
}
