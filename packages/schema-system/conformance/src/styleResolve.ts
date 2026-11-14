/**
 * Style case resolution: run the real `buildLayoutStyles`, then describe every emitted declaration
 * at the value level — the token a prop named and the value it computes to under a recorded theme.
 *
 * The emitted declaration is not what the vector asserts: `background-color: var(--we-role-accent)`
 * is a string any resolver can produce, and the Rust renderer's check is whether *its* token
 * resolution names the same token and lands on the same computed value. So `resolved` is per
 * authored prop:
 *
 * - `{"token": "surface", "px": 12}` — the value named a token; `px`/`color`/`value` is the
 *   computed value of `var(--we-<scale>-<token>)` from the theme's token table.
 * - `{"raw": "…", "computed": "…"}` — a raw CSS value (`calc()`, `rgba()`, a keyword); `computed`
 *   is `raw` with every `var(--we-*)` substituted from the table (fallbacks honoured), so a vector
 *   stays meaningful even where a var is page-defined rather than theme-defined.
 *
 * `style` keeps the emitted declaration object too — it is free evidence for a renderer that wants
 * the exact CSS, and it is what `resolved`'s var() references resolve through.
 */
import { buildLayoutStyles, tokenVar } from '../../../design-system/utils/src/index.ts';

export type TokenTable = Record<string, string>;

const VAR_RE = /var\(\s*(--we-[\w-]+)\s*(?:,\s*([^)]*))?\)/g;

/** `var()` references resolved against the theme's computed token table; unknown vars fall back. */
export function substituteVars(css: string, vars: TokenTable): string {
  let out = css;
  for (let i = 0; i < 8; i++) {
    const next = out.replace(VAR_RE, (_m, name: string, fallback?: string) =>
      name in vars ? vars[name] : fallback !== undefined ? fallback.trim() : _m,
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Which kind the computed value is: `px` numbers, `color` strings, or a plain `value`. */
function computedKind(computed: string): 'px' | 'color' | 'value' {
  if (/^-?[\d.]+px$/.test(computed)) return 'px';
  if (/^(#|rgb|hsl|oklch|oklab|lch|lab|hwb|color\(|color-mix\()/i.test(computed)) return 'color';
  return 'value';
}

const SINGLE_VAR = /^var\(--we-[\w-]+\)$/;

/** String form for a recorded value — numbers, booleans, or a JSON shape for objects. */
const text = (v: unknown): string => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

export interface ResolvedProp {
  /** The token name the authored value resolved to (e.g. "surface", "300"). */
  token?: string;
  /** The CSS custom property it emitted (e.g. "--we-role-surface"). */
  var?: string;
  px?: number;
  color?: string;
  /** `null` when `var` names a custom property nothing declares — the style paints nothing. */
  value?: string | null;
  raw?: string;
  computed?: string;
}

/**
 * One style case → `{ style, resolved }`. `style` is `buildLayoutStyles`'s output verbatim;
 * `resolved` walks the authored props and reports each prop's contribution: for a prop whose value
 * emitted a bare `var(--we-*)`, the token + its computed value; otherwise raw + computed.
 */
export function resolveStyleCase(
  props: Record<string, unknown>,
  direction: 'row' | 'column',
  vars: TokenTable,
): { style: Record<string, unknown>; resolved: Record<string, ResolvedProp> } {
  const style = buildLayoutStyles(props, direction) as Record<string, unknown>;
  const resolved: Record<string, ResolvedProp> = {};

  for (const [prop, value] of Object.entries(props)) {
    if (value === undefined) continue;
    /*
      Find this prop's emitted declaration. Most DS props map to one declaration; shorthand
      families (padding, margin, radius) merge into one — for those the authored value's own
      var()/literal is what `resolved` describes, since every side resolves independently.
    */
    const emitted = emittedFor(prop, value, style);
    if (emitted === undefined) continue;
    if (typeof emitted !== 'string') {
      resolved[prop] = { raw: text(emitted), computed: text(emitted) };
      continue;
    }
    if (SINGLE_VAR.test(emitted.trim())) {
      const name = emitted.trim().slice(4, -1);
      const computed = name in vars ? vars[name] : null;
      if (computed === null) {
        // A var nothing declares — "card"-style values emit this; it paints nothing.
        resolved[prop] = { token: text(value), var: name, value: null };
      } else {
        const kind = computedKind(computed);
        resolved[prop] = {
          token: text(value),
          var: name,
          ...(kind === 'px' ? { px: Number(computed.slice(0, -2)) } : { [kind]: computed }),
        };
      }
    } else {
      resolved[prop] = { raw: emitted, computed: substituteVars(emitted, vars) };
    }
  }
  return { style, resolved };
}

/**
 * The emitted declaration a prop produced, for token classification.
 *
 * For the shorthand families each authored side is resolved on its own (tokenVar is per-value),
 * so the prop's own `tokenVar` output is what is classified — recovered here by asking what the
 * value emits rather than trying to split the shorthand back apart.
 */
function emittedFor(prop: string, value: unknown, style: Record<string, unknown>): unknown {
  // Direction/reverse/ax/ay/wrap feed flex declarations jointly; report the emitted axis values.
  switch (prop) {
    case 'direction':
      return style['flex-direction'];
    case 'ax':
      return style['justify-content'] ?? style['align-items'];
    case 'ay':
      return style['align-items'] ?? style['justify-content'];
    case 'wrap':
      return style['flex-wrap'];
    case 'reverse':
      return style['flex-direction'];
    case 'display':
      return style.display;
    case 'bg':
      return style['background-color'] ?? style['background-image'];
    case 'bgImage':
      return style['background-image'] ?? style['--we-bg-image-composite'];
    case 'color':
      return style.color;
    case 'opacity':
      return style.opacity;
    case 'border':
      return style.border;
    case 'borderTop':
      return style['border-top'];
    case 'borderRight':
      return style['border-right'];
    case 'borderBottom':
      return style['border-bottom'];
    case 'borderLeft':
      return style['border-left'];
    case 'borderColor':
      return style['border-color'];
    case 'shadow':
    case 'ring':
      return style['box-shadow'];
    case 'transition':
      return style.transition;
    case 'textAlign':
      return style['text-align'];
    case 'fontFamily':
      return style['font-family'];
    case 'fontWeight':
      return style['font-weight'];
    case 'fontSize':
      return style['font-size'];
    case 'lineHeight':
      return style['line-height'];
    case 'letterSpacing':
      return style['letter-spacing'];
    case 'textDecoration':
      return style['text-decoration'];
    case 'textTransform':
      return style['text-transform'];
    case 'whiteSpace':
      return style['white-space'];
    case 'overflowWrap':
      return style['overflow-wrap'];
    case 'cursor':
      return style.cursor;
    case 'pointerEvents':
      return style['pointer-events'];
    case 'visibility':
      return style.visibility;
    case 'flex':
      return style.flex;
    case 'flexShrink':
      return style['flex-shrink'];
    case 'alignSelf':
      return style['align-self'];
    case 'width':
      return style.width;
    case 'height':
      return style.height;
    case 'minWidth':
      return style['min-width'];
    case 'minHeight':
      return style['min-height'];
    case 'maxWidth':
      return style['max-width'];
    case 'maxHeight':
      return style['max-height'];
    case 'aspectRatio':
      return style['aspect-ratio'];
    case 'gap':
      return style.gap;
    case 'overflow':
      return style.overflow;
    case 'overflowX':
      return style['overflow-x'];
    case 'overflowY':
      return style['overflow-y'];
    case 'scrollbarWidth':
      return style['scrollbar-width'];
    case 'scrollbarGutter':
      return style['scrollbar-gutter'];
    case 'zIndex':
      return style['z-index'];
    case 'position':
      return style.position;
    case 'top':
      return style.top;
    case 'right':
      return style.right;
    case 'bottom':
      return style.bottom;
    case 'left':
      return style.left;
    case 'tone':
      return toneEmitted(style);
    case 'styles':
      return undefined; // spread verbatim — nothing to resolve per-prop
    default:
      break;
  }
  // Shorthand families: padding (p,px,py,pt,pr,pb,pl), margin (m,mx,my,mt,mr,mb,ml), radius
  // (r,rr,rt,rb,rl,rtl,rtr,rbr,rbl). Each side resolves through tokenVar independently, so the
  // authored value's own emission is what is classified — a '300' is var(--we-space-300) wherever
  // it lands in the shorthand.
  return shorthandSide(prop, String(value));
}

/**
 * The emission a shorthand-family side resolves to, re-derived exactly as the resolver does —
 * margin sides are `tokenVar('space', v)`, padding `tokenVar('space', v, '0', 'padding')`, radius
 * `tokenVar('radius', v)` — because the shorthand itself joins four and cannot be split back into
 * "which of these vars was mine".
 */
function shorthandSide(prop: string, value: string): unknown {
  if (/^p[xytblr]?$/.test(prop)) return tokenVar('space', value, '0', 'padding');
  if (/^m[xytblr]?$/.test(prop)) return tokenVar('space', value);
  if (/^r(tl|tr|bl|br|t|b|l|r)?$/.test(prop)) return tokenVar('radius', value);
  return undefined;
}

/** tone emits a bag of accent role variables; report them joined so the case stays one entry. */
function toneEmitted(style: Record<string, unknown>): unknown {
  const tone = Object.entries(style)
    .filter(([k]) => k.startsWith('--we-'))
    .map(([k, v]) => `${k}:${text(v)}`)
    .join(';');
  return tone || undefined;
}
