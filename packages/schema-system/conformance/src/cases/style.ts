/**
 * Style vector inputs: `{ id, props, theme, direction? }` — run through `buildLayoutStyles`, the
 * neutral resolver every layout component calls. `theme` names which recorded token table
 * (`vectors/tokens/<theme>.json`) resolves the `var(--we-*)` values the resolver emits, so the
 * vector stores both halves: the token a prop named, and its computed value under that theme.
 *
 * - `TOKEN_CASES`: every token value the bundle uses, once per theme — the coverage contract is
 *   "each bundle token value under each preset", and `glow` is counted as a preset here.
 * - `RAW_CASES`: values that pass through untouched — raw CSS (`calc()`, `color-mix()`, `rgba()`,
 *   keywords, shorthand borders), recorded as `{ raw, computed }` with `var()` substituted.
 */
export interface StyleCase {
  id: string;
  props: Record<string, unknown>;
  theme: string;
  direction?: 'row' | 'column';
}

export const THEME_NAMES = ['light', 'dark', 'black', 'retro', 'cyberpunk', 'glow'] as const;

/* Every token-valued prop the bundle writes, and every token value it writes for it. */
const TOKEN_PROPS: Record<string, string[]> = {
  bg: [
    'chrome',
    'page',
    'surface',
    'surface-sunken',
    'surface-raised',
    'warning-soft',
    'control-surface',
    'accent-soft',
    'accent',
  ],
  color: [
    'text',
    'text-muted',
    'text-faint',
    'accent',
    'accent-text',
    'on-accent',
    'danger',
    'danger-text',
    'success',
    'success-text',
    'on-success',
    'warning-text',
    'cyan',
    'orange',
  ],
  gap: ['0', '100', '200', '300', '400', '500', '600', '800'],
  p: ['100', '200', '300', '400', '500', '600'],
  mt: ['200', '300'],
  mb: ['300', '500'],
  ml: ['200', '300'],
  mr: ['200'],
  pb: ['100', '200', '300', '500', '600'],
  pl: ['300', '400', '600', '900'],
  pt: ['100', '200', '300', '400', '500'],
  pr: ['100'],
  px: ['200', '300', '400', '500'],
  py: ['100', '200', '300', '400', '500'],
  fontSize: ['100', '200', '300', '400'],
  fontWeight: ['300', '500', '600', '700', '800', 'regular', 'semibold'],
  letterSpacing: ['tight', 'wide'],
  r: ['0', '200', '300', '400', '500', '600', 'surface', 'control', 'card', 'full'],
  rbl: ['500'],
  rbr: ['500'],
  shadow: ['lg'],
  zIndex: ['chrome', 'modal'],
  tone: ['danger', 'neutral', 'success'],
  top: ['100'],
  left: ['300', '600'],
  right: ['100'],
  bottom: ['300', '500'],
};

/* Token cases: every value once per preset. */
const tokenCases: StyleCase[] = Object.entries(TOKEN_PROPS).flatMap(([prop, values]) =>
  values.flatMap((v) =>
    THEME_NAMES.map((theme) => ({ id: `token.${prop}.${v}.${theme}`, props: { [prop]: v }, theme })),
  ),
);

/* Raw/literal cases — single theme is enough; the point is the resolver's pass-through. */
const RAW: [Record<string, unknown>, string?][] = [
  [{ bg: 'rgba(199,201,220,.08)' }],
  [{ bg: 'var(--we-role-success)' }],
  [{ bg: '#1b1e45' }],
  [{ bg: 'oklch(60% 0.15 250)' }],
  [{ color: 'rgba(255,255,255,.5)' }],
  [{ gap: '32px' }],
  [{ gap: 'var(--we-space-200)' }],
  [{ gap: '20px 30px' }],
  [{ p: 'calc(var(--we-avatar-size-sm) * 0.125)' }],
  [{ pb: 'calc(var(--we-space-500) + var(--we-covered-bottom, 0px))' }],
  [{ pl: 'calc((72px - 28px) / 2)' }],
  [{ mr: 'calc(max(0px, calc(3px - var(--we-scrollbar-thumb-inset))) - var(--we-space-300))' }],
  [
    {
      pr: 'max(0px, calc(var(--we-space-300) - max(0px, calc(3px - var(--we-scrollbar-thumb-inset))) - var(--we-scrollbar-width)))',
    },
  ],
  [{ mt: '-60px' }],
  [{ mt: 'auto' }, 'column'],
  [{ mx: 'auto' }],
  [{ ml: 'auto' }],
  [{ fontSize: '24px' }],
  [{ fontSize: '1rem' }],
  [{ lineHeight: 'normal' }],
  [{ lineHeight: '1.5' }],
  [{ lineHeight: '29px' }],
  [{ letterSpacing: '-0.01em' }],
  [{ letterSpacing: '0' }],
  [{ fontWeight: '450' }],
  [{ r: '18px' }],
  [{ r: '999px' }],
  [{ top: '0' }],
  [{ top: '55%' }],
  [{ top: 'var(--we-space-300)' }],
  [{ bottom: 'calc(var(--we-avatar-size-sm) * -0.1348)' }],
  [{ right: '0' }],
  [{ left: '12px' }],
  [{ width: '100%' }],
  [{ width: '12rem' }],
  [{ width: '100vw' }],
  [{ width: 'auto' }],
  [{ height: '100dvh' }],
  [{ height: '1lh' }],
  [{ height: 'var(--we-component-height-xs)' }],
  [{ maxWidth: '480px' }],
  [{ minHeight: '0' }],
  [{ aspectRatio: '16 / 9' }],
  [{ border: '1px solid border' }],
  [{ border: '1px dashed cyan' }],
  [{ border: '1px solid color-mix(in srgb, var(--we-role-border) 65%, var(--we-role-border-strong))' }],
  [{ border: '1px solid transparent' }],
  [{ border: '1px solid rgba(199,201,220,.3)' }],
  [{ borderTop: '4px solid accent' }],
  [{ borderBottom: '3px solid accent' }],
  [{ borderLeft: '1px solid border' }],
  [{ ring: '0 0 0 10px color-mix(in srgb, var(--we-role-accent) 18%, transparent)' }],
  [{ transition: 'opacity 300 ease-in-out' }],
  [{ transition: 'opacity var(--we-theme-state-duration, 300ms) ease-out' }],
  [{ display: 'contents' }],
  [{ display: 'none' }],
  [{ position: 'fixed' }],
  [{ position: 'absolute' }],
  [{ overflow: 'hidden' }],
  [{ overflowX: 'auto' }],
  [{ overflowWrap: 'anywhere' }],
  [{ whiteSpace: 'nowrap' }],
  [{ textAlign: 'center' }],
  [{ textTransform: 'uppercase' }],
  [{ textDecoration: 'underline' }],
  [{ cursor: 'zoom-in' }],
  [{ pointerEvents: 'none' }],
  [{ visibility: 'hidden' }],
  [{ flex: '1 1 200px' }],
  [{ flexShrink: 0 }],
  [{ alignSelf: 'flex-start' }],
  [{ opacity: 0.5 }],
  [{ scrollbarGutter: 'stable' }],
  [{ direction: 'vertical' }],
  [{ ax: 'between' }, 'row'],
  [{ ax: 'center', ay: 'end' }, 'row'],
  [{ ay: 'stretch' }, 'column'],
  [{ ax: 'start' }, 'column'],
  [{ wrap: true }],
  [{ reverse: true }, 'row'],
  [{ direction: 'vertical' }, 'column'],
  [{ bgImage: 'linear-gradient(180deg, rgba(13,15,38,0), rgba(13,15,38,.75))' }],
  [{ bgImage: 'none' }],
  [{ bgImage: 'url(x.png)', bgFit: 'contain', bgPosition: 'top' }],
  [{ bg: 'gradient-hero' }],
  [{ styles: { 'user-select': 'none', transform: 'rotate(2deg)' } }],
  [{ hoverProps: { bg: 'accent-soft' } }],
  [{ smUpProps: { p: '400' } }],
  [{ mdUpProps: { gap: '200' } }],
  [{ activeProps: { bg: 'accent-soft' } }],
  [{ focusProps: { borderColor: 'accent' } }],
  [{ borderRight: '2px solid border' }],
  [{ overflowY: 'scroll' }],
  [{ maxHeight: '80vh' }],
];

const rawCases: StyleCase[] = RAW.map(([props, direction], i) => ({
  id: `raw.${String(i + 1).padStart(3, '0')}`,
  props: direction ? { ...props, direction } : props,
  theme: 'dark',
  direction: 'row',
}));

/* A handful of multi-prop interactions, the order-sensitive ones (styles last, tone first). */
const COMBO: [Record<string, unknown>, string?][] = [
  [{ bg: 'surface', color: 'text', p: '300', r: 'card' }],
  [{ tone: 'danger', bg: 'accent', color: 'on-accent' }],
  [{ bg: 'accent', styles: { 'background-color': 'red' } }],
  [{ p: '300', px: '500', pt: '100' }],
  [{ m: '200', my: '300', mt: '100' }],
  [{ border: '1px solid border', borderBottom: '3px solid accent' }],
  [{ shadow: 'lg', ring: '0 0 0 2px var(--we-role-accent)' }],
  [{ width: '100%', maxWidth: '340px', minWidth: '120px' }],
  [{ opacity: 0.5, transition: 'opacity 200 ease-in-out' }],
  [{ fontSize: '300', fontWeight: 'semibold', lineHeight: 'normal', letterSpacing: 'wide' }],
];
const comboCases: StyleCase[] = COMBO.flatMap(([props], i) =>
  THEME_NAMES.map((theme) => ({ id: `combo.${i + 1}.${theme}`, props, theme, direction: 'row' as const })),
);

/*
 * Raw `var(--we-*)` prop values — the bundle writes them directly (e.g. bg="var(--we-role-success)").
 * tokenVar passes a bare var() through unchanged, so they record as token lookups: the var they
 * name resolves out of every theme table, hence once per preset like TOKEN_PROPS.
 */
const VAR_PASSTHROUGH: Record<string, string[]> = {
  bg: ['var(--we-role-success)'],
  top: ['var(--we-space-300)'],
  gap: ['var(--we-space-200)'],
  height: ['var(--we-component-height-xs)'],
};
const varCases: StyleCase[] = Object.entries(VAR_PASSTHROUGH).flatMap(([prop, values]) =>
  values.flatMap((v) => THEME_NAMES.map((theme) => ({ id: `var.${prop}.${theme}`, props: { [prop]: v }, theme }))),
);

export const STYLE_CASES: StyleCase[] = [...tokenCases, ...rawCases, ...comboCases, ...varCases];
