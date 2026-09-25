/**
 * Declarative styling — rules, not callbacks.
 *
 * The widget this replaces took `size?: (node) => number` and `color?: (node) => string`, which is
 * why no template ever used it: a schema is JSON and JSON has no functions. Every style decision here
 * is therefore data, and the match vocabulary is deliberately the one WE's schema system already uses
 * for `$filter` — `contains`, `exists`, `not`, `in` — so an author who can filter a list can style a
 * graph without learning a second dialect.
 *
 * Rules are evaluated in order and shallow-merged, last match winning per property. That makes
 * "everything is grey, beliefs are purple, *unresolved* beliefs are outlined" three rules that read
 * top to bottom, rather than one condition tree.
 *
 * Where a value genuinely has to be computed — size by centrality, colour by a scale — the answer is
 * not to grow this vocabulary toward a programming language. It is {@link MetricRef}: a named,
 * registered plugin, referenced from data with parameters. Same bargain the template system makes
 * with components.
 */
import type { GraphNode, GraphValue } from './graph';
import type { EdgeCurve, EdgeSide } from './layout';

/** Operators a match clause may use against a node/edge field. Mirrors the schema system's `$filter`. */
export interface MatchOperators {
  not?: GraphValue | GraphValue[];
  contains?: string;
  exists?: boolean;
  in?: GraphValue[];
  gt?: number;
  lt?: number;
}

/**
 * A match clause. Keys are `kind`, `type`, `label`, `unresolved`, or `data.<field>`; sibling keys are
 * ANDed. A bare value means equality.
 */
export type MatchClause = Record<string, GraphValue | MatchOperators>;

/**
 * A value computed by a registered metric rather than read off the node.
 *
 * This is the escape hatch, and it is the reason the rule vocabulary can stay small: anything
 * computational becomes a plugin with a name and parameters, so the data surface never has to grow
 * conditionals, arithmetic or scales.
 */
export interface MetricRef {
  /** Registered metric id — `degree`, `betweenness`, `community`, … */
  metric: string;
  /** Metric-specific options, passed through untouched. */
  options?: Record<string, unknown>;
  /** Map the metric's normalised 0..1 output onto an output range. */
  range?: [number, number];
  /** Map onto a named colour scale instead of a numeric range. */
  scale?: string;
}

/**
 * A value read off the subject itself, rather than written into the rule.
 *
 * The sibling of {@link MetricRef}, and the other half of the same bargain: a metric answers
 * "computed from the graph's shape", this answers "already on the record". It exists because a rule
 * list is fixed when the template is written, and per-instance presentation is not — a canvas where
 * every card carries its own size and colour would otherwise need one rule per card, minted by
 * whatever drew them.
 *
 * `from` uses the {@link MatchClause} key vocabulary, so `data.canvasColor` reaches into the data bag
 * and a bare name reads a field. **A reference the subject cannot answer contributes nothing**: the
 * property falls through to whatever an earlier rule set, rather than to the built-in default. That
 * is what lets a per-card colour sit in front of a per-type colour and only override the cards that
 * actually carry one.
 */
export interface FieldRef<T> {
  /** Field path on the node or edge — `data.<field>`, or a bare field name. */
  from: string;
  /** Used when the field is present but the wrong type. Absence is *not* an error; it defers. */
  fallback?: T;
}

export type StyleValue<T> = T | MetricRef | FieldRef<T>;

/**
 * A card's outline. Only meaningful for `shape: 'card'`.
 *
 * Presentation a person chooses per card, which is why it is separate from `shape` rather than more
 * values on it: `shape: 'card'` is structural — it decides that the content goes *inside* the box —
 * and a card that stopped being a card the moment somebody rounded it would drop its content.
 */
export type CardShape = 'note' | 'square' | 'round' | 'triangle' | 'diamond' | 'pentagon' | 'hexagon';

export interface NodeStyle {
  /** Radius in world units, or the box's half-height for non-circular shapes. */
  size?: StyleValue<number>;
  /** Design token (`primary-500`) or CSS colour. Tokens resolve against the live theme. */
  color?: StyleValue<string>;
  borderColor?: string;
  borderWidth?: number;
  /**
   * `dashed` for a node that stands for something not yet settled — a suggestion nobody has kept.
   * Default `solid`. A line style rather than a colour because the difference is a state, and a card
   * keeps whatever fill a key gives it either way.
   */
  borderStyle?: 'solid' | 'dashed';
  /**
   * `circle` and `rect` draw in both DOM and canvas modes; `template` requires DOM.
   *
   * `card` is the post-it: a sized box with the label *inside* it, wrapped, rather than a mark with a
   * caption underneath. Worth being a shape rather than a flag because it changes what `size` means —
   * a card is `width` × `height`, not a radius — and because a canvas is mostly cards.
   */
  shape?: 'circle' | 'rect' | 'card' | 'template';
  /** Card width in world units. Only meaningful for `shape: 'card'`; defaults to a readable box. */
  width?: StyleValue<number>;
  /** Card height. Defaults to `width` × 0.75, roughly a post-it. */
  height?: StyleValue<number>;
  /** The card's outline — see {@link CardShape}. Defaults to `note`. */
  cardShape?: StyleValue<CardShape>;
  /**
   * How large the card's *content* is drawn, as a multiplier. Default 1.
   *
   * Not a zoom and not a font size: it scales the whole content — text, images, everything the
   * content component draws — inside a box whose size does not change, so a smaller scale fits more
   * of the document into the same card. Presentation only. The document is untouched, and the same
   * post on another canvas can be shown at another scale.
   */
  contentScale?: StyleValue<number>;
  /**
   * Stacking order among nodes: higher is drawn in front, and is what a press on an overlap picks.
   * Default 0, and ties keep the order the graph already had.
   *
   * A style rather than a layout concern because on a canvas it is presentation a person chose per
   * card — "this photo goes on top of that note" — and it is kept beside the card's colour and size.
   * Rounded to a whole number, since that is all a stacking order can be.
   */
  z?: StyleValue<number>;
  opacity?: number;
  labelColor?: string;
  labelSize?: number;
  /** Hide the label below this zoom, so a dense graph stays readable when zoomed out. */
  labelMinZoom?: number;
  /**
   * Name of a registered node-content renderer to draw *inside* the node.
   *
   * The escape hatch `scalars()` has always pointed at — "anything else belongs behind a node
   * template". A label is one string, which is right for a mark with a caption and hopeless for a
   * card standing in for a document: a post holding an image, a task and three paragraphs shows as
   * its first sixty characters, and everything else in it silently is not there.
   *
   * Named rather than passed, like every other plugin here, so a template stays JSON. The component
   * itself arrives through the host bindings — which is what keeps a block renderer, and everything
   * it drags in, out of a graph package that is meant to be portable.
   *
   * Only meaningful on `shape: 'card'`. A dot has nowhere to put it.
   */
  content?: string;
  /**
   * Hide the content below this zoom, falling back to the label.
   *
   * The sibling of `labelMinZoom`, and the answer to the one thing that decides whether rich cards
   * scale: a hundred documents rendered at once is a hundred component trees, and at the zoom where
   * a canvas is a wall of coloured rectangles none of them can be read anyway.
   */
  contentMinZoom?: number;
  /**
   * Whether the label grows and shrinks with the camera. Default `true`.
   *
   * `false` pins it to a constant on-screen size, which keeps text readable at any zoom — right for a
   * map you navigate by reading, wrong for a canvas where the text *is* the artwork.
   *
   * Only the label. A node's mark always scales: its size is world units and so is its hit area, and
   * letting the two disagree is precisely the class of bug where what you can click stops matching
   * what you can see.
   */
  scaleLabelWithZoom?: boolean;
  icon?: string;
  image?: string;
  /** Name of a registered node renderer, when the built-in shapes are not enough. */
  renderer?: string;
}

export interface EdgeStyle {
  width?: StyleValue<number>;
  color?: StyleValue<string>;
  opacity?: number;
  /** `bezier` is the readable default for dense graphs; `orthogonal` suits trees and flows. */
  /**
   * See `EdgeCurve`. `bezier` and `orthogonal` are accepted as the previous names for `arc` and
   * `step`, so templates written against them keep working.
   */
  curve?: EdgeCurve | 'bezier' | 'orthogonal';
  arrow?: 'none' | 'target' | 'both';
  dashed?: boolean;
  /**
   * Whether stroke width grows with the camera. Default `true`.
   *
   * `true` treats the edge as part of the drawing, which is what a canvas wants — zoom in and the line
   * gets thicker, like ink. `false` keeps it a constant on-screen width, which is what a large network
   * wants, since hairlines vanish when you zoom out to see the whole thing.
   */
  scaleWithZoom?: boolean;
  showLabel?: boolean;
  labelColor?: string;
  /**
   * Which side of each node the line leaves and arrives on — see {@link EdgeSide}.
   *
   * Normally derived from where the two nodes are, which is right on a canvas: a line between two cards
   * somebody placed should take the shortest sensible path. It is wrong wherever the *arrangement*
   * carries the meaning. In a downward tree a parent's children sit below it and spread sideways, so the
   * geometry attaches the outer ones to their left and right edges while the middle one gets its top —
   * three children, three different-looking relationships, when they are the same relationship.
   * `{ sourceAnchor: 's', targetAnchor: 'n' }` says "these hang off the bottom" and the rank reads as one.
   *
   * A rule, so it is behind an edge's own stored anchors rather than in front of them: those are one
   * canvas's tidying of one connection, which is the more specific fact, exactly as a card's own colour
   * sits in front of its type's.
   */
  sourceAnchor?: EdgeSide;
  targetAnchor?: EdgeSide;
  /**
   * Ignore what one canvas has tidied about this connection — its stored anchors and the points it is bent
   * through — and draw it as the rules say.
   *
   * The precedence above is right on a canvas and wrong wherever the ARRANGEMENT is what carries the
   * meaning. In a tree every child hangs off its parent's underside and is met at its own top, and that
   * uniformity is the whole of what makes a rank readable — so a line somebody once pulled to a card's left
   * side, or bent around something that is no longer in the way, is one card disagreeing with the shape for
   * a reason that belonged to a different reading of the same records.
   *
   * Nothing is unwritten. The route is still stored, still the canvas's, and comes back the moment the
   * arrangement that reads it does.
   */
  ignoreRoute?: boolean;
}

/** One rule: match, then apply. A rule with no `when` is the base style. */
export interface StyleRule<TStyle> {
  when?: MatchClause;
  style: TStyle;
}

/**
 * An ordered rule list, where an entry may itself be a list.
 *
 * Nesting exists because a schema cannot build one array out of two. `$concat` joins strings, and
 * there is no array-merge operator — so a template that wants a base rule plus one rule *per row of
 * data* has no way to write the combined array, and styling driven by a community's own vocabulary
 * is unreachable. That is the case this is for: a `$map` over the relationship kinds a space has
 * named produces a rule each, and it sits in the list beside the hand-written ones.
 *
 * Flattened before use, so precedence reads exactly as written — a nested group applies in the
 * position it occupies, and later matches still win per property.
 */
export type StyleRules<TStyle> = (StyleRule<TStyle> | StyleRule<TStyle>[])[];

export type NodeStyleRules = StyleRules<NodeStyle>;
export type EdgeStyleRules = StyleRules<EdgeStyle>;

/**
 * A registered metric.
 *
 * Runs over the visible graph on demand — a user action, an expansion settling — never per frame.
 * Returns a value per node, which the core normalises before a {@link MetricRef} maps it onto a range
 * or a scale.
 */
export interface Metric {
  id: string;
  description?: string;
  /**
   * `nodes` are the nodes as everything downstream sees them, **data included**.
   *
   * It used to be `{ id }` alone, on the reasoning that a metric is about the graph's *shape*. That
   * was true of the two that existed and false of the interesting one: "colour by how strongly people
   * feel about this" reads a number off the node and needs to know the range the rest of the graph
   * spans, which is exactly a metric's job and is impossible from ids. Widening it costs the existing
   * metrics nothing — they go on reading `id` — and is what `field` is built on.
   */
  compute(
    graph: { nodes: GraphNode[]; edges: { source: string; target: string }[] },
    options?: Record<string, unknown>,
  ): Map<string, number>;
}

/**
 * What each card shape is actually drawn as, in fractions of its box, clockwise from the top.
 *
 * **One outline, four consumers.** The renderer already derived three things from these points so
 * they could not disagree — the clip a card is cut to, the ring behind it when it is selected, and
 * the floats its text wraps to. The fourth is where an edge attaches, and it was the one that did
 * not: routing met the card's *box*, which is what the shape is cut *out of*. Where the outline
 * touches the box there was no gap and nothing looked wrong; where it does not, the line stopped in
 * mid-air — 45px short of a triangle's side on a 180px card, a quarter of its width.
 *
 * So the table lives here, in the vocabulary both sides share, rather than in the renderer that
 * happened to need it first.
 *
 * Only the shapes a radius cannot make. `square` and `note` are the box (a note's corner radius is
 * small enough that nothing attaches inside it), and `round` is the ellipse inscribed in the box —
 * exact by formula, and a polygon of it would be an approximation of something already known.
 */
export const CARD_SILHOUETTES: Partial<Record<CardShape, readonly (readonly [number, number])[]>> = {
  triangle: [
    [0.5, 0],
    [1, 1],
    [0, 1],
  ],
  diamond: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  pentagon: [
    [0.5, 0],
    [1, 0.38],
    [0.82, 1],
    [0.18, 1],
    [0, 0.38],
  ],
  hexagon: [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ],
};

/** The outline of a shape that has one — a cut card. `undefined` for a box, an ellipse, or a dot. */
export function cardSilhouette(shape?: CardShape): readonly (readonly [number, number])[] | undefined {
  return shape ? CARD_SILHOUETTES[shape] : undefined;
}

/**
 * How many points a circle is worth while it is turning into something else.
 *
 * Only ever seen mid-morph, which is what lets it be this low: at rest a round card is drawn by a
 * border radius and attached to by formula, both exact.
 *
 * The number is set by the *first* frame rather than by the moving ones. A round card's own radius is
 * still drawing it there, and the polygon is inscribed in that circle — so too few points and the clip
 * shaves visible flats off a circle nothing has started morphing yet. Twenty-four holds the deepest cut
 * under one percent of the card's half-extent, which is under a pixel on any card somebody would read,
 * and matches the sampling the text floats already use for the same ellipse.
 */
const ROUND_STEPS = 24;

/**
 * Every shape as a polygon, for the one job a name cannot do: turning into another shape.
 *
 * `CARD_SILHOUETTES` above is deliberately partial — a box and an ellipse are *better* described by a
 * radius than by points, and the table says so. That holds right up until two shapes have to be
 * blended, because a name does not interpolate and a border radius cannot be lerped against a polygon.
 *
 * So this is the same shapes in the one representation that can be blended, and it is **transient by
 * design**: nothing draws from it at rest. A note card keeps its real corner radius and its real
 * `box-shadow`, and only borrows a four-point box for as long as it is between two shapes. That is the
 * whole reason a fidelity compromise here is free — sixteen points for a circle, none for a note's
 * rounded corners — where the same compromise applied at rest would be a regression to every card.
 *
 * Minimal point counts rather than a dense resampling of everything, which is the other decision worth
 * stating: the outline is read per frame by four things (the clip, the two text-flow floats and the
 * selection ring), and one of those does real geometry per point. `blendOutlines` sizes itself to the pair
 * accordingly — a diamond becoming a square is described in eight directions where a circle becoming a note
 * takes forty.
 *
 * Measured, blending and stringifying for 200 cards: 0.12 ms a frame for that eight, 0.36 for a
 * twenty-four, 0.84 for the forty. So the JavaScript is free at any card count a canvas holds, and what is
 * left to watch is the browser's own cost for that many changing `clip-path`s — which is the reason a dense
 * resampling of everything would be a different proposition rather than a slower version of this one.
 */
/**
 * How much of a note's corner is rounded, as a fraction of its box, and in how many steps.
 *
 * A note's real corners come from a radius token in pixels, so a fraction is an approximation — of a
 * length that also varies with the card. It is the right approximation anyway, and for a reason worth
 * stating, because the alternative (four sharp corners) is not neutral: **a polygon has the corners it
 * is given for the whole of the blend**, and a card is *clipped* to it. A note drawn with four sharp
 * corners keeps its radius the whole way and cannot show it, because the polygon cuts the rounded region
 * off — so the radius appears in one step at the end, exactly when the clip stops cutting. Rounding the
 * polygon instead lets the corner be round throughout, which is what it looks like it should do.
 *
 * A twelfth of the box is close to the radius token at the card sizes this is seen at, and four steps is
 * enough that it reads as a curve rather than as a chamfer.
 */
const NOTE_CORNER = 1 / 12;
const CORNER_STEPS = 4;

/** One corner of a rounded box, as points, turning from `fromAngle` a quarter turn clockwise. */
function noteCorner(cx: number, cy: number, fromAngle: number): (readonly [number, number])[] {
  return Array.from({ length: CORNER_STEPS + 1 }, (_, i) => {
    const angle = fromAngle + (i / CORNER_STEPS) * (Math.PI / 2);
    return [cx + NOTE_CORNER * Math.cos(angle), cy + NOTE_CORNER * Math.sin(angle)] as const;
  });
}

export const MORPH_OUTLINES: Record<CardShape, readonly (readonly [number, number])[]> = {
  /*
    A rounded box, clockwise from the top-left corner's start — see `NOTE_CORNER` for why it is rounded
    rather than the four points a box would take.
  */
  note: [
    ...noteCorner(NOTE_CORNER, NOTE_CORNER, Math.PI),
    ...noteCorner(1 - NOTE_CORNER, NOTE_CORNER, -Math.PI / 2),
    ...noteCorner(1 - NOTE_CORNER, 1 - NOTE_CORNER, 0),
    ...noteCorner(NOTE_CORNER, 1 - NOTE_CORNER, Math.PI / 2),
  ],
  // Square keeps its four, because its corners are the point of choosing it over a note.
  square: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  round: Array.from({ length: ROUND_STEPS }, (_, i) => {
    const angle = -Math.PI / 2 + (i / ROUND_STEPS) * Math.PI * 2;
    return [0.5 + 0.5 * Math.cos(angle), 0.5 + 0.5 * Math.sin(angle)] as const;
  }),
  triangle: CARD_SILHOUETTES.triangle!,
  diamond: CARD_SILHOUETTES.diamond!,
  pentagon: CARD_SILHOUETTES.pentagon!,
  hexagon: CARD_SILHOUETTES.hexagon!,
};

/** The polygon a shape is blended as — see {@link MORPH_OUTLINES}. */
export function morphOutline(shape?: CardShape): readonly (readonly [number, number])[] {
  return MORPH_OUTLINES[shape ?? 'note'] ?? MORPH_OUTLINES.note;
}
