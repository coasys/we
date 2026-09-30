/**
 * The editor's pure helpers, extracted from their components so they are
 * importable by tests (and by each other) without mounting anything.
 *
 * Before this module existed, the editor's only test re-implemented the
 * function it was testing because the original closed over a component-scoped
 * ref — a test that could never fail when the component changed. Everything
 * here is arithmetic or string/structure work with no DOM and no Solid.
 */
import type {
  ConditionExpr,
  ConditionOperand,
  FormStateToken,
  ScopeGroup,
  ScopeRef,
  ScopeValueType,
} from '@we/schema-shared';
import { isUnaryOperator } from '@we/schema-shared';

// ── Overlay geometry ────────────────────────────────────────────────────────

export type HandleId = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Pixels within which a resize snaps to a size token. */
export const SNAP_THRESHOLD = 8;

export function nearestToken(
  px: number,
  tokens: Array<{ token: string; px: number }>,
): { token: string; px: number } | null {
  let best: { token: string; px: number } | null = null;
  let bestDist = Infinity;
  for (const t of tokens) {
    const dist = Math.abs(px - t.px);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return bestDist <= SNAP_THRESHOLD ? best : null;
}

export function isWidthHandle(h: HandleId): boolean {
  return ['e', 'w', 'ne', 'nw', 'se', 'sw'].includes(h);
}
export function isHeightHandle(h: HandleId): boolean {
  return ['n', 's', 'ne', 'nw', 'se', 'sw'].includes(h);
}
export function isLeftHandle(h: HandleId): boolean {
  return ['w', 'nw', 'sw'].includes(h);
}
export function isTopHandle(h: HandleId): boolean {
  return ['n', 'ne', 'nw'].includes(h);
}

export function handleCursor(h: HandleId): string {
  if (h === 'n' || h === 's') return 'ns-resize';
  if (h === 'e' || h === 'w') return 'ew-resize';
  if (h === 'ne' || h === 'sw') return 'nesw-resize';
  return 'nwse-resize';
}

/** Compute a single size delta for uniform-resize props, signed toward "grow". */
export function computeSizeDelta(h: HandleId, dx: number, dy: number): number {
  const xDelta = isLeftHandle(h) ? -dx : isWidthHandle(h) ? dx : 0;
  const yDelta = isTopHandle(h) ? -dy : isHeightHandle(h) ? dy : 0;
  if (xDelta !== 0 && yDelta !== 0) return (xDelta + yDelta) / 2;
  return xDelta || yDelta;
}

export interface RelativeRect {
  top: string;
  left: string;
  width: string;
  height: string;
}

/**
 * Normalise a viewport rect against the overlay's own rect — the subtraction
 * that cancels the viewport out of the overlay's coordinate contract.
 */
export function toRelativeRect(rect: DOMRect, base: DOMRect): RelativeRect {
  return {
    top: `${rect.top - base.top}px`,
    left: `${rect.left - base.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

// ── Focus-ring shorthand ────────────────────────────────────────────────────

export const RING_THEME_ACCENT = 'var(--we-ring-color)';

export interface ParsedRing {
  widthPx: number;
  blurPx: number;
  /** A color token like 'success-400', RING_THEME_ACCENT, or an unrecognized raw CSS color. */
  color: string;
}

export function parseRing(value: string): ParsedRing | null {
  const m = /^0\s+0\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(.+)$/.exec(value.trim());
  if (!m) return null;
  const [, blurRaw, widthRaw, colorRaw] = m;
  const color = colorRaw.trim();
  const parsed: ParsedRing = { widthPx: Number(widthRaw), blurPx: Number(blurRaw), color };
  if (/^var\(--we-ring-color(?:\s*,.*)?\)$/.test(color)) return { ...parsed, color: RING_THEME_ACCENT };
  const tokenMatch = /^var\(--we-color-([a-z]+-\d+|white|black)\)$/.exec(color);
  if (tokenMatch) return { ...parsed, color: tokenMatch[1] };
  return parsed;
}

export function composeRing(widthPx: number, blurPx: number, color: string): string {
  const colorCss = color === RING_THEME_ACCENT || color.includes('(') ? color : `var(--we-color-${color})`;
  return `0 0 ${blurPx}px ${widthPx}px ${colorCss}`;
}

// ── Condition operands ──────────────────────────────────────────────────────

const FORM_STATE_LABELS: Record<FormStateToken, (field: string) => string> = {
  formValid: () => 'all fields are valid',
  valid: (field) => `${field} is valid`,
  touched: (field) => `${field} was edited`,
  error: (field) => `${field} error message`,
};

export function operandLabel(operand: ConditionOperand | undefined): string {
  if (!operand) return '';
  switch (operand.kind) {
    case 'store':
    case 'local':
    case 'context':
      return operand.path;
    case 'list':
      return operand.value.join(', ');
    case 'count':
      return `count of ${operandLabel(operand.items) || '…'}`;
    case 'formState':
      return FORM_STATE_LABELS[operand.token](operand.field);
    case 'literal':
      if (operand.value === null) return 'null';
      if (operand.value === '') return '';
      return String(operand.value);
  }
}

/** The referenced path, or undefined for operands that aren't a plain reference. */
export function refPath(operand: ConditionOperand | undefined): string | undefined {
  if (!operand) return undefined;
  return operand.kind === 'store' || operand.kind === 'local' || operand.kind === 'context' ? operand.path : undefined;
}

/** Map a scope ref onto the operand kind that serializes to the same token. */
export function refToOperand(ref: ScopeRef): ConditionOperand {
  if (ref.kind === 'store') return { kind: 'store', path: ref.path };
  if (ref.kind === 'local') return { kind: 'local', path: ref.path };
  return { kind: 'context', path: ref.path };
}

/** The declared type of the picked reference, used to type the opposite side's literal input. */
export function operandValueType(operand: ConditionOperand | undefined, scope: ScopeGroup[]): ScopeValueType {
  if (!operand) return 'unknown';
  if (operand.kind === 'literal') {
    if (typeof operand.value === 'boolean') return 'boolean';
    if (typeof operand.value === 'number') return 'number';
    return 'string';
  }
  if (operand.kind === 'list') return 'array';
  if (operand.kind === 'count') return 'number';
  if (operand.kind === 'formState') return operand.token === 'error' ? 'string' : 'boolean';
  for (const group of scope) {
    for (const ref of group.refs) {
      if (ref.path === operand.path) return ref.valueType;
    }
  }
  return 'unknown';
}

export function operandComplete(operand: ConditionOperand | undefined): boolean {
  if (!operand) return false;
  switch (operand.kind) {
    case 'list':
      return operand.value.length > 0;
    case 'literal':
      return operand.value !== '';
    case 'count':
      return operandComplete(operand.items);
    case 'formState':
      return operand.field.trim() !== '';
    default:
      return operand.path.trim() !== '';
  }
}

export function exprComplete(expr: ConditionExpr): boolean {
  if (expr.type === 'group') return expr.children.length > 0 && expr.children.every(exprComplete);
  if (!operandComplete(expr.left)) return false;
  return isUnaryOperator(expr.operator) ? true : operandComplete(expr.right);
}
