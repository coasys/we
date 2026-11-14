//! The per-type DS-prop default bags — Rust ports of each primitive's
//! `getInstanceProps()` merge: `DEFAULT_PROPS`, plus variant- and
//! size-conditioned tables.
//!
//! This is where "the look comes from `Style` first, then the widget's own
//! token defaults" happens: these bags hold *token names* (`"surface"`,
//! `"accent-soft"`), never colours — [`style_of`] resolves
//! them through the theme's `TokenTable`.
use std::sync::Arc;
use std::sync::LazyLock;

use indexmap::IndexMap;
use we_expr::Value;
use we_style::{Style, StyleInput, TokenTable};
use we_template::ResolvedNode;

use crate::props::{prop_str, Bag};

/// The font metrics `em`/`rem`/`lh` resolve against. WE's body text is 14px
/// (`--we-font-size-300`); `rem` is 16 by CSS rule.
pub const FONT_PX: f32 = 14.0;
pub const ROOT_PX: f32 = 16.0;

/// What a style resolution needs beyond the bag: the theme's token table,
/// the viewport for `vw`/`vh`, and the container width the `*UpProps` tiers
/// resolve against.
#[derive(Clone, Copy)]
pub struct StyleCx<'a> {
    pub tokens: &'a TokenTable,
    pub viewport: we_style::Size,
    pub container_width: f32,
}

impl<'a> StyleCx<'a> {
    /// An empty-table context — styles resolve every `var(--we-*)` to
    /// "unset" (the recorded-table answer for a theme that declares
    /// nothing). Tests that want real colours hand a real table.
    pub fn empty() -> Self {
        static EMPTY: LazyLock<TokenTable> = LazyLock::new(|| TokenTable::new(IndexMap::new()));
        Self {
            tokens: &EMPTY,
            viewport: we_style::Size::new(0.0, 0.0),
            container_width: 0.0,
        }
    }
}

/// One authored value → the bag entry.
fn v(s: &str) -> Value {
    Value::Str(Arc::from(s))
}

fn entries(bag: &mut Bag, pairs: &[(&str, &str)]) {
    for (k, val) in pairs {
        bag.insert(Arc::from(*k), v(val));
    }
}

/// The component's flex direction for `resolve()`'s axis mapping: `Row`'s is
/// `row`; `Card`/`Grid`/`div`/`we-link` take their `direction` prop (default
/// `column`); everything else is `column`.
pub fn direction_of(node: &ResolvedNode) -> we_style::Direction {
    match prop_str(node, "direction") {
        Some("row" | "row-reverse") => return we_style::Direction::Row,
        Some("column" | "column-reverse") => return we_style::Direction::Column,
        _ => {}
    }
    match node.ty.as_ref() {
        "Row" => we_style::Direction::Row,
        _ => we_style::Direction::Column,
    }
}

/// `tone` picks the toned side of a variant table — `tone` present and not
/// `"neutral"`, the same rule `getInstanceProps` applies.
fn toned(node: &ResolvedNode) -> bool {
    matches!(prop_str(node, "tone"), Some(t) if t != "neutral")
}

/// `variant`/`size` with the primitive's fallbacks.
fn variant<'a>(node: &'a ResolvedNode, default: &'a str) -> &'a str {
    prop_str(node, "variant").unwrap_or(default)
}

fn size<'a>(node: &'a ResolvedNode, default: &'a str) -> &'a str {
    prop_str(node, "size").unwrap_or(default)
}

/// The merged DS-prop bag for a node: type defaults at the bottom, then the
/// authored props, then the `style` object (a `div`'s CSS bag), then the
/// `styles` escape hatch on top — the same precedence the TS applies.
pub(crate) fn bag_for(node: &ResolvedNode) -> Bag {
    let mut bag = Bag::new();
    type_defaults(&mut bag, node);
    for (k, val) in &node.props {
        // Widget props (`text`, `name`, `onClick`…) pass through the bag —
        // `resolve()` ignores what it does not own (and counts it).
        bag.insert(k.clone(), val.clone());
    }
    // `div`'s `style` object and every widget's `styles` hatch: object props
    // whose entries are declarations. Written over the props, matching the
    // inline-style cascade.
    if let Some(obj) = crate::props::prop_obj(node, "style") {
        for (k, val) in obj {
            bag.insert(k.clone(), val.clone());
        }
    }
    if let Some(obj) = crate::props::prop_obj(node, "styles") {
        for (k, val) in obj {
            bag.insert(k.clone(), val.clone());
        }
    }
    bag
}

/// The node's [`we_style::Style`] under `scx`'s theme — the single entry
/// point layout, measure and paint share.
pub fn style_of(node: &ResolvedNode, scx: &StyleCx) -> Style {
    let bag = bag_for(node);
    let mut input = StyleInput::new(scx.tokens, direction_of(node));
    input.container_width = scx.container_width;
    input.viewport = scx.viewport;
    input.font_px = FONT_PX;
    input.root_px = ROOT_PX;
    we_style::resolve(&bag, &input)
}

/// Per-type DS defaults — the token-name bags the TS primitives merge
/// beneath authored props. Dispatch is by `ty`.
fn type_defaults(bag: &mut Bag, node: &ResolvedNode) {
    match node.ty.as_ref() {
        "we-button" => {
            // DEFAULT_PROPS (cursor/focus are egui's own concerns — `focusProps`
            // still merges so a focus ring resolves where a theme paints one).
            entries(bag, &[("r", "400"), ("ax", "center"), ("ay", "center")]);
            // Variant: toned when `tone` is set and not neutral.
            let t = toned(node);
            match variant(node, "solid") {
                "soft" => {
                    if t {
                        entries(bag, &[("bg", "accent-soft"), ("color", "accent-text")]);
                    } else {
                        entries(bag, &[("bg", "control-surface"), ("color", "text")]);
                    }
                }
                "outline" => {
                    if t {
                        entries(
                            bag,
                            &[
                                ("bg", "transparent"),
                                ("color", "accent-text"),
                                ("border", "1px solid var(--we-role-accent-border)"),
                            ],
                        );
                    } else {
                        entries(
                            bag,
                            &[
                                ("bg", "transparent"),
                                ("color", "text"),
                                ("border", "1px solid var(--we-role-border)"),
                            ],
                        );
                    }
                }
                "ghost" => {
                    if t {
                        entries(bag, &[("bg", "transparent"), ("color", "accent-text")]);
                    } else {
                        entries(bag, &[("bg", "transparent"), ("color", "text")]);
                    }
                }
                "bare" => {
                    entries(
                        bag,
                        &[("bg", "transparent"), ("height", "auto"), ("r", "0")],
                    );
                    // The bare host rule zeroes the base part's padding too.
                    bag.insert(Arc::from("px"), v("0"));
                }
                _ => {
                    // solid — same table either way.
                    entries(bag, &[("bg", "accent"), ("color", "on-accent")]);
                }
            }
            // Size: font size + component height + the [part='base'] padding
            // cascade — `0 <x>` whose x falls through the theme override vars
            // to the size tier's space token (button.ts's `--we-button-size-
            // padding-x`). Vertical padding stays 0; the height is fixed.
            let (fs, h, px) = match size(node, "md") {
                "xs" => ("100", "xs", "var(--we-space-200)"),
                "sm" => ("200", "sm", "var(--we-space-300)"),
                "lg" => ("500", "lg", "var(--we-space-500)"),
                "xl" => ("500", "xl", "var(--we-space-500)"),
                _ => ("300", "md", "var(--we-space-400)"),
            };
            entries(bag, &[("fontSize", fs)]);
            bag.insert(
                Arc::from("px"),
                v(&format!(
                    "var(--we-theme-button-padding-x, var(--we-theme-control-padding-x, {px}))"
                )),
            );
            bag.insert(
                Arc::from("height"),
                v(&format!(
                    "calc(var(--we-component-height-{h}) + var(--we-theme-control-height-offset, 0px))"
                )),
            );
            // square: width = height = component height, padding removed.
            if crate::props::prop_bool(node, "square") {
                let h = v(&format!(
                    "calc(var(--we-component-height-{}) + var(--we-theme-control-height-offset, 0px))",
                    match size(node, "md") {
                        "xs" => "xs",
                        "sm" => "sm",
                        "lg" => "lg",
                        "xl" => "xl",
                        _ => "md",
                    }
                ));
                bag.insert(Arc::from("width"), h.clone());
                bag.insert(Arc::from("height"), h);
                bag.shift_remove("px");
                bag.shift_remove("py");
            }
        }
        "we-badge" => {
            entries(
                bag,
                &[
                    ("bg", "surface-sunken"),
                    ("color", "text-muted"),
                    ("fontSize", "300"),
                    ("fontWeight", "400"),
                    ("r", "400"),
                    ("ax", "center"),
                    ("ay", "center"),
                ],
            );
            match (variant(node, "soft"), toned(node)) {
                ("solid", true) => entries(bag, &[("bg", "accent"), ("color", "on-accent")]),
                ("solid", false) => entries(bag, &[("bg", "control-surface"), ("color", "text")]),
                (_, true) => entries(bag, &[("bg", "accent-soft"), ("color", "accent-text")]),
                _ => entries(bag, &[("bg", "control-surface"), ("color", "text-muted")]),
            }
            // Same padding cascade as the button, on the badge's own theme
            // var (badge.ts's `--we-badge-size-padding-x`).
            let (fs, h, px) = match size(node, "md") {
                "xs" => ("100", "xs", "var(--we-space-200)"),
                "sm" => ("200", "sm", "var(--we-space-300)"),
                "lg" => ("500", "lg", "var(--we-space-500)"),
                "xl" => ("500", "xl", "var(--we-space-500)"),
                _ => ("300", "md", "var(--we-space-400)"),
            };
            let h = format!(
                "calc(var(--we-component-height-{h}) + var(--we-theme-control-height-offset, 0px))"
            );
            entries(bag, &[("fontSize", fs)]);
            bag.insert(
                Arc::from("px"),
                v(&format!(
                    "var(--we-theme-badge-padding-x, var(--we-theme-control-padding-x, {px}))"
                )),
            );
            bag.insert(Arc::from("height"), v(&h));
            bag.insert(Arc::from("minWidth"), v(&h));
        }
        "we-tag" => {
            entries(
                bag,
                &[
                    ("display", "inline-flex"),
                    ("ay", "center"),
                    ("gap", "100"),
                    ("px", "200"),
                    ("py", "100"),
                    ("r", "pill"),
                    ("fontSize", "100"),
                ],
            );
            match (variant(node, "soft"), toned(node)) {
                ("solid", true) => entries(bag, &[("bg", "accent"), ("color", "on-accent")]),
                ("solid", false) => entries(bag, &[("bg", "control-surface"), ("color", "text")]),
                (_, true) => entries(bag, &[("bg", "accent-soft"), ("color", "accent-text")]),
                _ => entries(bag, &[("bg", "surface-sunken"), ("color", "text")]),
            }
        }
        "we-alert" => {
            entries(
                bag,
                &[
                    ("display", "flex"),
                    ("ay", "start"),
                    ("gap", "300"),
                    ("px", "400"),
                    ("py", "300"),
                    ("r", "400"),
                    ("fontSize", "300"),
                ],
            );
            let t = toned(node) || prop_str(node, "tone").is_none();
            match variant(node, "soft") {
                "edge" => entries(bag, &[("bg", "surface"), ("color", "text")]),
                _ if t => entries(bag, &[("bg", "accent-soft"), ("color", "accent-text")]),
                _ => entries(bag, &[("bg", "surface"), ("color", "text")]),
            }
        }
        "we-skeleton" => {
            entries(
                bag,
                &[("display", "flex"), ("r", "400"), ("bg", "surface-sunken")],
            );
        }
        "we-avatar" => {
            entries(bag, &[("flex", "0 0 auto")]);
        }
        "we-text" => {
            // Variant table — display face for headings.
            match variant(node, "") {
                "heading-sm" => entries(
                    bag,
                    &[
                        ("fontSize", "500"),
                        ("fontWeight", "bold"),
                        (
                            "fontFamily",
                            "var(--we-theme-heading-font-family, var(--we-font-family))",
                        ),
                    ],
                ),
                "heading-md" => entries(
                    bag,
                    &[
                        ("fontSize", "600"),
                        ("fontWeight", "bold"),
                        (
                            "fontFamily",
                            "var(--we-theme-heading-font-family, var(--we-font-family))",
                        ),
                    ],
                ),
                "heading-lg" => entries(
                    bag,
                    &[
                        ("fontSize", "700"),
                        ("fontWeight", "bold"),
                        (
                            "fontFamily",
                            "var(--we-theme-heading-font-family, var(--we-font-family))",
                        ),
                    ],
                ),
                "heading-xl" => entries(
                    bag,
                    &[
                        ("fontSize", "800"),
                        ("fontWeight", "bold"),
                        (
                            "fontFamily",
                            "var(--we-theme-heading-font-family, var(--we-font-family))",
                        ),
                    ],
                ),
                "subheading" => entries(bag, &[("fontSize", "400"), ("fontWeight", "medium")]),
                "ingress" => entries(bag, &[("fontSize", "400"), ("lineHeight", "1.6")]),
                "footnote" => entries(bag, &[("fontSize", "100")]),
                "overline" => entries(
                    bag,
                    &[
                        ("fontSize", "100"),
                        ("letterSpacing", "wide"),
                        ("textTransform", "uppercase"),
                    ],
                ),
                _ => {}
            }
            // `uppercase`/`italic` are widget props — the transform lands in
            // the text painter, not the bag.
        }
        "we-divider" => {
            // The primitive defaults are CSS on the part; the thickness and
            // colour come out in paint.
        }
        "Card" => card_defaults(bag),
        "we-tooltip" | "Grid" | "div" | "Row" | "Column" => {}
        _ => {}
    }
}

/// `Card`'s surface defaults — the layout factory's `family: 'surface'`
/// axes + its shadow default. Separate because `Card` reads `direction` for
/// resolve.
pub(crate) fn card_defaults(bag: &mut Bag) {
    entries(
        bag,
        &[
            ("r", "surface"),
            ("p", "surface"),
            ("gap", "surface"),
            ("bg", "surface"),
            ("shadow", "var(--we-theme-shadow, none)"),
        ],
    );
}
