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
use we_metrics::UnitMetrics;
use we_style::{Style, StyleInput, TokenTable};
use we_template::ResolvedNode;

use crate::props::{prop_str, Bag};

/// The theme's base font-size: `--we-font-size-300`, the recorded scale's
/// `1rem` step. The recorder evaluated it under the theme's own root size
/// (`fontScale` already multiplied in — 16px on most themes, 13 on
/// cyberpunk), which on the web side is exactly what unstyled text
/// inherits and what `1rem` means.
fn base_font_px(scx: &StyleCx) -> Option<f32> {
    scx.tokens
        .get("--we-font-size-300")
        .and_then(|v| v.strip_suffix("px").and_then(|n| n.parse().ok()))
}

/// The unit metrics this context resolves `em`/`rem`/`ch`/`ex`/`lh`
/// against — `scx.metrics` with the theme's recorded base font-size
/// folded in (`--we-font-size-300` feeds both `em` and `rem`, the way the
/// recorded scale works). The one place the fold happens — read this,
/// never `scx.metrics` bare, when a length resolves.
pub fn unit_metrics(scx: &StyleCx) -> UnitMetrics {
    let base = base_font_px(scx);
    UnitMetrics {
        font_px: base.unwrap_or(scx.metrics.font_px),
        root_px: base.unwrap_or(scx.metrics.root_px),
        ..scx.metrics
    }
}

/// What a style resolution needs beyond the bag: the theme's token table,
/// the viewport for `vw`/`vh`, the container width the `*UpProps` tiers
/// resolve against, and the custom-property scope the resolved ancestors
/// hand down (CSS custom-property inheritance — a `tone`/`styles` node's
/// `--we-*` decls scope every descendant's `var()`).
#[derive(Clone, Copy)]
pub struct StyleCx<'a> {
    pub tokens: &'a TokenTable,
    /// The theme's id — the `[data-we-theme='x']` selector in `theme_css`.
    /// `""` for a context built without a theme (tests, token-free docs):
    /// no component stylesheet applies, the token-only answer.
    pub theme: &'a str,
    pub viewport: we_style::Size,
    pub container_width: f32,
    /// The unit metrics the entry point configured — `em`/`rem`/`ch`/`ex`/
    /// `lh` resolve against it through [`unit_metrics`], which folds the
    /// theme's recorded `--we-font-size-300` over `font_px`/`root_px`.
    pub metrics: UnitMetrics,
    /// The ancestors' custom-property scope — empty for a layout root.
    /// [`layout`](crate::layout) reseeds it from each node's resolved
    /// [`Style::scope`] as it descends.
    pub scope: &'a IndexMap<Arc<str>, Arc<str>>,
}

impl<'a> StyleCx<'a> {
    /// An empty-table context — styles resolve every `var(--we-*)` to
    /// "unset" (the recorded-table answer for a theme that declares
    /// nothing). Tests that want real colours hand a real table.
    pub fn empty() -> Self {
        static EMPTY: LazyLock<TokenTable> = LazyLock::new(|| TokenTable::new(IndexMap::new()));
        static EMPTY_SCOPE: LazyLock<IndexMap<Arc<str>, Arc<str>>> = LazyLock::new(IndexMap::new);
        Self {
            tokens: &EMPTY,
            theme: "",
            viewport: we_style::Size::new(0.0, 0.0),
            container_width: 0.0,
            metrics: UnitMetrics::default(),
            scope: &EMPTY_SCOPE,
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
/// `column`); `we-button` maps on `row`, as the primitives' `mapFlexAxes(props,
/// props.direction ?? 'row')` does (its `[part=base]` is a row); everything
/// else is `column`.
pub fn direction_of(node: &ResolvedNode) -> we_style::Direction {
    match prop_str(node, "direction") {
        Some("row" | "row-reverse") => return we_style::Direction::Row,
        Some("column" | "column-reverse") => return we_style::Direction::Column,
        _ => {}
    }
    match node.ty.as_ref() {
        "Row" | "we-button" | "we-input" => we_style::Direction::Row,
        _ => we_style::Direction::Column,
    }
}

/// `tone` picks the toned side of a variant table — `tone` truthy and not
/// `"neutral"` (badge.ts `this.tone && this.tone !== 'neutral'`): an
/// empty string is no tone.
fn toned(node: &ResolvedNode) -> bool {
    matches!(prop_str(node, "tone"), Some(t) if !t.is_empty() && t != "neutral")
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
    // A folded home lane takes no room (`PanelLane`: `width: 0`,
    // `min-width: 0`, `visibility: hidden`) — its sections stay mounted
    // behind the clip, and its own fill and edge go with it.
    if node.ty.as_ref() == "$lane" && crate::props::prop_bool(node, "collapsed") {
        for k in [
            "bg",
            "border",
            "borderLeft",
            "borderRight",
            "borderTop",
            "borderBottom",
        ] {
            bag.shift_remove(k);
        }
        bag.insert(Arc::from("width"), Value::Str(Arc::from("0px")));
        bag.insert(Arc::from("minWidth"), Value::Str(Arc::from("0")));
        bag.insert(Arc::from("overflow"), Value::Str(Arc::from("hidden")));
    }
    bag
}

/// The type role a component's words are set in — helpers.ts
/// `COMPONENT_CASCADE[name].typeRole`. `we-text` takes its role from its
/// variant: the heading sizes are headings, `label` and `overline` their own,
/// and every other variant (and none) takes nothing, so text inside a button
/// inherits the button's control type.
fn role_of(node: &ResolvedNode) -> Option<&'static str> {
    match node.ty.as_ref() {
        "we-button" | "we-menu-item" | "we-tab" => Some("control"),
        "we-badge" | "we-tag" => Some("badge"),
        "we-input" | "we-textarea" | "we-select" | "we-number-input" | "we-date-picker" => {
            Some("body")
        }
        "we-text" => match prop_str(node, "variant") {
            Some(v) if v.starts_with("heading") => Some("heading"),
            Some("label") => Some("label"),
            Some("overline") => Some("overline"),
            _ => None,
        },
        _ => None,
    }
}

/// The DS prop each type-role key lands on, and the key's variable suffix
/// (`TYPE_ROLE_KEYS`).
const ROLE_KEYS: &[(&str, &str)] = &[
    ("fontFamily", "family"),
    ("fontSize", "size"),
    ("fontWeight", "weight"),
    ("letterSpacing", "letter-spacing"),
    ("lineHeight", "line-height"),
    ("textTransform", "text-transform"),
    ("color", "color"),
];

/// Whether the author set `key` — on the node, or in its `style`/`styles`
/// bags. An authored value is the narrowest statement and the theme never
/// reaches past it.
fn authored(node: &ResolvedNode, key: &str) -> bool {
    node.props.contains_key(key)
        || ["style", "styles"]
            .iter()
            .any(|o| crate::props::prop_obj(node, o).is_some_and(|m| m.contains_key(key)))
}

/// Put the theme's type role ahead of the element's own defaults: the web
/// writes `var(--we-type-<role>-<key>, <default>)` for every key the author
/// did not set (`applyComponentTheme`, `staticThemeChain`). A variable the
/// theme does not declare falls through to the default, which is what
/// leaving the bag alone gives — so only the declared ones are written. The
/// heading role takes no size (`roleTakes`): headings are a scale.
fn type_role(bag: &mut Bag, node: &ResolvedNode, tokens: &we_style::TokenTable) {
    let Some(role) = role_of(node) else {
        return;
    };
    for (prop, key) in ROLE_KEYS {
        if role == "heading" && *key == "size" {
            continue;
        }
        let var = format!("--we-type-{role}-{key}");
        if tokens.contains(&var) && !authored(node, prop) {
            bag.insert(Arc::from(*prop), v(&format!("var({var})")));
        }
    }
}

/// The node's [`we_style::Style`] under `scx`'s theme — the single entry
/// point layout, measure and paint share.
pub fn style_of(node: &ResolvedNode, scx: &StyleCx) -> Style {
    let mut bag = bag_for(node);
    type_role(&mut bag, node, scx.tokens);
    let mut input = StyleInput::new(scx.tokens, direction_of(node));
    input.container_width = scx.container_width;
    input.viewport = scx.viewport;
    input.metrics = unit_metrics(scx);
    input.inherited = scx.scope;
    let mut style = we_style::resolve(&bag, &input);
    // The theme's component stylesheet — `[data-we-theme='x'] x::part(*)`
    // rules a var read cannot carry — lands over the resolved bags.
    crate::theme_css::apply(scx, node, &mut style);
    style
}

/// `style` with the parent's inherited text style merged in and `opacity`
/// composed — what CSS calls the node's computed style. Layout fields
/// never inherit, so the box side of `style` passes through untouched.
pub fn effective(parent: Option<&Style>, style: Style) -> Style {
    let mut style = style;
    if let Some(p) = parent {
        style.text.inherit_from(&p.text);
        style.paint.opacity =
            Some(p.paint.opacity.unwrap_or(1.0) * style.paint.opacity.unwrap_or(1.0));
    }
    style
}

/// Per-type DS defaults — the token-name bags the TS primitives merge
/// beneath authored props. Dispatch is by `ty`.
fn type_defaults(bag: &mut Bag, node: &ResolvedNode) {
    match node.ty.as_ref() {
        "we-button" => {
            // DEFAULT_PROPS (cursor is egui's own concern). `focusProps: {
            // ring: FOCUS_RING }` applies to EVERY variant — bare included —
            // so keyboard focus paints the `--we-ring-color` ring.
            entries(bag, &[("r", "400"), ("ax", "center"), ("ay", "center")]);
            if !bag.contains_key("focusProps") {
                let mut focus = IndexMap::new();
                focus.insert(
                    Arc::from("ring"),
                    Value::Str(Arc::from(
                        "0 0 0 var(--we-focus-ring-width) var(--we-ring-color)",
                    )),
                );
                bag.insert(Arc::from("focusProps"), Value::Obj(Arc::new(focus)));
            }
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
            // `[part=base]`'s gap: the theme's button/control gap, then the
            // size tier's `--we-button-size-gap` (helpers.ts COMPONENT_CASCADE).
            // The slot is `display: contents`, so it spaces the children.
            let gap = match size(node, "md") {
                "xs" => "var(--we-space-100)",
                "sm" => "var(--we-space-200)",
                _ => "var(--we-space-300)",
            };
            bag.insert(
                Arc::from("gap"),
                v(&format!(
                    "var(--we-theme-button-gap, var(--we-theme-control-gap, {gap}))"
                )),
            );
            // The variant merges over the size tier: `bare`'s `height: auto`
            // and zero padding win, so it wraps what it holds (a card).
            if variant(node, "solid") != "bare" {
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
            }
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
        "we-input" => {
            // input.ts DEFAULT_PROPS: a recessed well with an outline, its
            // own row (`display: flex`, `ay: center`) holding the `start`
            // slot, the text and the `end` slot. The size tier sets the
            // padding, the font and the control height.
            entries(
                bag,
                &[
                    ("bg", "field"),
                    ("border", "1px solid border"),
                    // `r: '300'` reaches the CSS through the input family
                    // (helpers.ts `radiusGroup: --we-theme-input-radius`).
                    ("r", "input"),
                    ("color", "text"),
                    ("ay", "center"),
                ],
            );
            let state = |pairs: &[(&str, &str)]| {
                let mut m = IndexMap::new();
                for (k, val) in pairs {
                    m.insert(Arc::from(*k), v(val));
                }
                Value::Obj(Arc::new(m))
            };
            if !bag.contains_key("hoverProps") {
                bag.insert(
                    Arc::from("hoverProps"),
                    state(&[("bg", "field-hover"), ("border", "1px solid border-hover")]),
                );
            }
            if !bag.contains_key("focusProps") {
                bag.insert(
                    Arc::from("focusProps"),
                    state(&[
                        ("bg", "field-hover"),
                        ("border", "1px solid var(--we-ring-color)"),
                        // FOCUS_RING_BEYOND_BORDER: the pixel outside the
                        // recoloured border, so the two read as one ring.
                        (
                            "ring",
                            "0 0 0 max(0px, calc(var(--we-focus-ring-width) - var(--we-border-width, 1px))) var(--we-ring-color)",
                        ),
                    ]),
                );
            }
            let (px, fs, h) = match size(node, "md") {
                "xs" => ("100", "100", "xs"),
                "sm" => ("200", "200", "sm"),
                "lg" => ("400", "400", "lg"),
                "xl" => ("500", "400", "xl"),
                _ => ("300", "300", "md"),
            };
            entries(bag, &[("px", px), ("fontSize", fs)]);
            if !bag.contains_key("height") {
                bag.insert(
                    Arc::from("height"),
                    v(&format!(
                        "calc(var(--we-component-height-{h}) + var(--we-theme-control-height-offset, 0px))"
                    )),
                );
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
            // helpers.ts: `avatar: { radiusGroup: --we-theme-avatar-radius,
            // radiusDefault: '50%' }` — the `avatar` family.
            entries(bag, &[("flex", "0 0 auto"), ("r", "avatar")]);
            // `:host` pins both dims to `--we-avatar-size`, and the tier
            // rules point it at `--we-avatar-size-{tier}` — without them a
            // `stretch` parent widens the face (the TS element's own
            // width/height are what stop it, not `flex`). A tier name reads
            // its var; a custom size is a CSS length/number.
            let dim = match node.props.get("size") {
                Some(Value::Str(s)) => match s.as_ref() {
                    t @ ("xxs" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl") => {
                        format!("var(--we-avatar-size-{t})")
                    }
                    other => other.to_string(),
                },
                Some(Value::Num(n)) => format!("{n}px"),
                _ => "var(--we-avatar-size, var(--we-avatar-size-md))".to_string(),
            };
            entries(bag, &[("width", &dim), ("height", &dim)]);
        }
        "we-icon" => {
            // icon.ts: `:host([size='xs']) → --icon-size: var(--we-size-xs)`
            // — tiers read the theme var so a theme that moves
            // `--we-size-lg` moves the glyph. Raw lengths/numbers stay the
            // widget's own `size` handling; the unset default
            // (`var(--we-context-icon-size, var(--we-size-md))`) needs the
            // context-var bridge we do not plumb, so it is left to the
            // inherited font size for now.
            if let Some(Value::Str(t)) = node.props.get("size") {
                if matches!(t.as_ref(), "xxs" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl") {
                    let fs = format!("var(--we-size-{t})");
                    entries(bag, &[("fontSize", &fs)]);
                }
            }
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
                // text.ts VARIANT_DEFAULTS: body `{ fontSize: '300' }`,
                // label `{ fontSize: '200', fontWeight: 'medium' }`.
                "body" => entries(bag, &[("fontSize", "300")]),
                "label" => entries(bag, &[("fontSize", "200"), ("fontWeight", "medium")]),
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
            // `uppercase` is a widget prop — the transform lands in the
            // text painter. `italic` is a bag entry (`font-style` is real
            // CSS and inherits): the TS `:host([italic])` sets the same
            // var on the element.
            if crate::props::prop_bool(node, "italic") {
                entries(bag, &[("fontStyle", "italic")]);
            }
        }
        "we-tree" | "we-tree-item" => {
            // `STACKED`: rows stack, `space-100` apart unless the theme sets
            // the tree's gap. A row's text is muted until it is lit.
            entries(
                bag,
                &[
                    ("direction", "column"),
                    ("gap", "var(--we-theme-tree-gap, var(--we-space-100))"),
                ],
            );
            if node.ty.as_ref() == "we-tree-item" {
                entries(bag, &[("color", "text-muted")]);
            }
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
