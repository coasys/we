import { For } from 'solid-js';

// ─── Appearance constants ────────────────────────────────────────────────────
/** Pixel gap between adjacent hexagons (reduces polygon radius). */
const HEX_GAP = 8;
/** Corner radius applied to hexagon vertices (0 = sharp, higher = rounder). */
const HEX_CORNER_RADIUS = 12;
/** How many degrees of hue the gradient shifts either side of the base colour.
 *  e.g. 25 → centre of hex is base, edges shift ±25° in hue. */
const HEX_HUE_SHIFT = 15;
/** Size of the inner white hexagon as a fraction of the outer polygon radius (0–1). */
const HEX_INNER_RATIO = 0.8;
// ────────────────────────────────────────────────────────────────────────────

export interface HexFeature {
  name: string;
  icon: string;
  color: string;
  description?: string;
}

interface HexagonGridProps {
  features: HexFeature[];
  size?: number;
}

// Pointy-top hexagon vertices centered at (cx, cy) with outer radius R
// Vertices at 30°+60°·i (tip pointing up/down)
function hexVertices(cx: number, cy: number, R: number): { x: number; y: number }[] {
  return [30, 90, 150, 210, 270, 330].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + R * Math.cos(rad), y: cy + R * Math.sin(rad) };
  });
}

/** Build an SVG path string for a regular hexagon with rounded corners.
 *  Each corner is replaced by a small arc of radius `cr` (corner radius). */
function hexRoundedPath(cx: number, cy: number, R: number, cr: number): string {
  const verts = hexVertices(cx, cy, R);
  const n = verts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const prev = verts[(i + n - 1) % n];
    const curr = verts[i];
    const next = verts[(i + 1) % n];
    // Unit vectors from curr towards its two neighbours
    const toPrev = { x: prev.x - curr.x, y: prev.y - curr.y };
    const toNext = { x: next.x - curr.x, y: next.y - curr.y };
    const lenPrev = Math.hypot(toPrev.x, toPrev.y);
    const lenNext = Math.hypot(toNext.x, toNext.y);
    const safeR = Math.min(cr, lenPrev / 2, lenNext / 2);
    // Arc start/end points (offset from vertex along each edge)
    const p1 = { x: curr.x + (toPrev.x / lenPrev) * safeR, y: curr.y + (toPrev.y / lenPrev) * safeR };
    const p2 = { x: curr.x + (toNext.x / lenNext) * safeR, y: curr.y + (toNext.y / lenNext) * safeR };
    if (i === 0) d += `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
    else d += ` L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
    d += ` Q ${curr.x.toFixed(2)} ${curr.y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d + ' Z';
}

// ─── Colour utilities ─────────────────────────────────────────────────────────
/** Parse a hex colour string (#rrggbb) into [r, g, b] 0-255. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Convert RGB (0-255) to HSL (h: 0-360, s: 0-100, l: 0-100). */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

/** Build an HSL CSS string, clamping hue to [0, 360). */
function hsl(h: number, s: number, l: number): string {
  return `hsl(${((h % 360) + 360) % 360}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

/** Derive the gradient stop colours for a hex given its base colour string. */
function gradientStops(color: string, hueShift: number): { inner: string; outer: string } {
  const [r, g, b] = hexToRgb(color);
  const [h, s, l] = rgbToHsl(r, g, b);
  return {
    inner: hsl(h + hueShift, s, l),
    outer: hsl(h - hueShift, s, l),
  };
}
// ─────────────────────────────────────────────────────────────────────────────

// Outer ring angles for pointy-top hex neighbors (clockwise from upper-right).
// In SVG coordinates (y-down), the 6 neighbor directions of a pointy-top hex are at:
// 300° (upper-right), 0° (right), 60° (lower-right), 120° (lower-left), 180° (left), 240° (upper-left)
const OUTER_ANGLES_DEG = [300, 0, 60, 120, 180, 240];

export default function HexagonGrid(props: HexagonGridProps) {
  const size = () => props.size ?? 480;
  // R derived so that the rendered height equals `size` exactly (H = 5R → R = size/5)
  const R = () => size() / 5;
  // Distance between adjacent hex centers = R * √3
  const D = () => R() * Math.sqrt(3);

  // Tight bounding box of the 7-hex pointy-top flower:
  //   width  = 3 * R * √3  (left-hex left-vertex → right-hex right-vertex)
  //   height = 5 * R       (upper-hex top-vertex → lower-hex bottom-vertex)
  const W = () => 3 * R() * Math.sqrt(3);
  const H = () => 5 * R();
  const cx = () => W() / 2;
  const cy = () => H() / 2;

  // Center of each of the 7 hexagons:
  //   index 0 = center hex (features[0])
  //   indices 1-6 = outer ring, clockwise from upper-right (features[1-6])
  const centers = () => {
    const list = [{ x: cx(), y: cy() }];
    for (const deg of OUTER_ANGLES_DEG) {
      const rad = (deg * Math.PI) / 180;
      list.push({
        x: cx() + D() * Math.cos(rad),
        y: cy() + D() * Math.sin(rad),
      });
    }
    return list;
  };

  const iconSize = () => `${Math.round(R() * 0.44)}px`;
  const labelSize = () => `${Math.round(R() * 0.165)}px`;

  return (
    <div
      style={{
        position: 'relative',
        width: `${W()}px`,
        height: `${H()}px`,
        'user-select': 'none',
      }}
    >
      {/* SVG layer — hexagon shapes */}
      <svg
        viewBox={`0 0 ${W()} ${H()}`}
        width={W()}
        height={H()}
        style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
      >
        {/* Gradient definitions — one radial gradient per feature */}
        <defs>
          <For each={props.features}>
            {(feature, i) => {
              const stops = gradientStops(feature.color, HEX_HUE_SHIFT);
              return (
                <linearGradient id={`hg-grad-${i()}`} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color={stops.inner} />
                  <stop offset="100%" stop-color={stops.outer} />
                </linearGradient>
              );
            }}
          </For>
        </defs>

        <For each={props.features}>
          {(feature, i) => {
            const c = () => centers()[i()];
            const outerR = () => R() - HEX_GAP;
            const innerR = () => outerR() * HEX_INNER_RATIO;
            return (
              <>
                {/* Outer coloured hexagon */}
                <path
                  d={hexRoundedPath(c().x, c().y, outerR(), HEX_CORNER_RADIUS)}
                  fill={`url(#hg-grad-${i()})`}
                  style={{
                    filter: 'drop-shadow(0 8px 8px rgba(0,0,0,0.5))',
                    // cursor: 'pointer',
                  }}
                />
                {/* Inner white hexagon */}
                <path
                  d={hexRoundedPath(c().x, c().y, innerR(), HEX_CORNER_RADIUS * HEX_INNER_RATIO)}
                  fill="#ffffffb2"
                  opacity="0.8"
                  style={{ 'pointer-events': 'none', filter: 'drop-shadow(0 5px 5px rgba(0,0,0,0.5))' }}
                />
              </>
            );
          }}
        </For>
      </svg>

      {/* HTML overlay layer — icons and labels centered over each hex */}
      <For each={props.features}>
        {(feature, i) => {
          const c = () => centers()[i()];
          return (
            <div
              style={{
                position: 'absolute',
                left: `${c().x}px`,
                top: `${c().y}px`,
                transform: 'translate(-50%, -50%)',
                display: 'flex',
                'flex-direction': 'column',
                'align-items': 'center',
                gap: '6px',
                'text-align': 'center',
                width: `${(R() - HEX_GAP) * HEX_INNER_RATIO * 1.55}px`,
                'pointer-events': 'none',
                color: '#374151',
              }}
            >
              {/* Icon uses the outer hex colour; text is dark grey */}
              <we-icon
                name={feature.icon}
                size="60px" // iconSize()
                style={{ color: feature.color, filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.4))' }}
              />
              <span
                style={{
                  'font-family': 'var(--we-font-family)',
                  'font-size': '18px', //labelSize(),
                  'font-weight': '600',
                  'line-height': '1.2',
                }}
              >
                {feature.name}
              </span>
            </div>
          );
        }}
      </For>
    </div>
  );
}
