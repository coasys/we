//! `we-style`: design-system props → [`Style`] — tokens, the five presets and
//! the bundle's `glow` theme.
//!
//! The crate has two halves. [`props`] is the *emission* half — the port of
//! `buildLayoutStyles` and the state/tier bag machinery, turning resolved
//! node props into the same CSS declarations the TypeScript emits. The
//! evaluation half then substitutes the theme's [`TokenTable`] and parses
//! each declaration into [`Style`]'s plain Rust fields — [`LayoutStyle`],
//! [`TextStyle`], [`PaintStyle`], plus the [`StylePatch`]es the state bags
//! (`hoverProps` …) ask for. Whatever survives as unevaluated text — an
//! undeclared `var()`, a gradient, a `color-mix` we do not compute — is kept
//! verbatim in [`Style::unsupported`] rather than guessed.
//!
//! No egui, no I/O, no tokio: this crate builds for `wasm32-unknown-unknown`.
//! Turning a [`Style`] into `taffy::Style` and egui paint ops is `we-widgets`'
//! job.

#![forbid(unsafe_code)]

pub mod border;
pub mod color;
pub mod css_value;
pub mod props;
pub mod scales;
pub mod shorthand;
pub mod style;
pub mod theme;
pub mod tokens;
pub mod transition;

pub use color::{eval_color, Color};
pub use css_value::{eval_dimension, eval_math};
pub use props::{
    build_layout_decls, build_state_fragment_decls, emitted_for, eval_decls, interactive_decls,
    is_design_prop, is_interactive_prop, merge_props, resolve, DeclValue, Decls, EvalCx,
    EvalResult, StyleInput,
};
pub use shorthand::{state_bag_filled, tier_bag_of, with_box_sides_filled, Bag, Tier};
pub use style::*;
pub use theme::{Polarity, Theme, ThemeSet};
pub use tokens::{TokenTable, TokenTableError};
pub use transition::{parse_transitions, Easing, Transition};

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;
    use std::sync::Arc;
    use we_expr::Value;

    fn bag(pairs: &[(&str, &str)]) -> Bag {
        pairs
            .iter()
            .map(|(k, v)| (Arc::from(*k), Value::Str(Arc::from(*v))))
            .collect::<IndexMap<Arc<str>, Value>>()
    }

    #[test]
    fn empty_style_is_empty() {
        let _style = Style::empty();
    }

    #[test]
    fn base_decls_carry_structural_defaults() {
        let decls = build_layout_decls(&Bag::new(), Direction::Column);
        assert_eq!(decls["display"].text(), "flex");
        assert_eq!(decls["flex-direction"].text(), "column");
        assert_eq!(decls["flex-wrap"].text(), "nowrap");
        // no props → no other declarations
        assert_eq!(decls.len(), 3);
    }

    #[test]
    fn token_prop_emits_var() {
        let decls = build_layout_decls(&bag(&[("bg", "surface")]), Direction::Row);
        assert_eq!(decls["background-color"].text(), "var(--we-role-surface)");
        assert_eq!(
            decls["background-image"].text(),
            "var(--we-surface-image-surface, none)"
        );
    }

    #[test]
    fn raw_prop_passthrough() {
        let decls = build_layout_decls(&bag(&[("width", "300px")]), Direction::Row);
        assert_eq!(decls["width"].text(), "300px");
    }
}
