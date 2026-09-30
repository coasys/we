/**
 * The editor's pure helpers — imported from the real module, so these tests
 * fail when the editor changes. (The previous geometry test re-implemented
 * the function it tested because the original closed over a component ref;
 * see src/helpers.ts for the extraction.)
 */
import type { ConditionExpr, ScopeGroup } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import {
  composeRing,
  computeSizeDelta,
  exprComplete,
  handleCursor,
  nearestToken,
  operandComplete,
  operandLabel,
  operandValueType,
  parseRing,
  refToOperand,
  RING_THEME_ACCENT,
  toRelativeRect,
} from '../src/helpers';

describe('nearestToken', () => {
  const tokens = [
    { token: 'sm', px: 24 },
    { token: 'md', px: 40 },
    { token: 'lg', px: 64 },
  ];

  it('snaps to the closest token within the threshold', () => {
    expect(nearestToken(42, tokens)).toEqual({ token: 'md', px: 40 });
    expect(nearestToken(58, tokens)).toEqual({ token: 'lg', px: 64 });
  });

  it('returns null when nothing is close enough', () => {
    expect(nearestToken(100, tokens)).toBeNull();
    expect(nearestToken(10, [])).toBeNull();
  });
});

describe('computeSizeDelta', () => {
  it('grows positively away from the anchor on every handle', () => {
    expect(computeSizeDelta('e', 10, 0)).toBe(10);
    expect(computeSizeDelta('w', -10, 0)).toBe(10); // dragging left = growing
    expect(computeSizeDelta('s', 0, 8)).toBe(8);
    expect(computeSizeDelta('n', 0, -8)).toBe(8);
  });

  it('averages the axes on a corner handle', () => {
    expect(computeSizeDelta('se', 10, 20)).toBe(15);
    expect(computeSizeDelta('nw', -10, -20)).toBe(15);
  });

  it('a corner drag along one axis uses that axis alone', () => {
    expect(computeSizeDelta('se', 10, 0)).toBe(10);
  });
});

describe('handleCursor', () => {
  it('matches the resize direction', () => {
    expect(handleCursor('n')).toBe('ns-resize');
    expect(handleCursor('e')).toBe('ew-resize');
    expect(handleCursor('ne')).toBe('nesw-resize');
    expect(handleCursor('se')).toBe('nwse-resize');
  });
});

describe('toRelativeRect', () => {
  it('cancels the viewport out of the coordinate pair', () => {
    const rect = { top: 150, left: 220, width: 40, height: 20 } as DOMRect;
    const base = { top: 100, left: 200 } as DOMRect;
    expect(toRelativeRect(rect, base)).toEqual({ top: '50px', left: '20px', width: '40px', height: '20px' });
  });

  it('scrolling moves rect and base together, so the result is stable', () => {
    const before = toRelativeRect(
      { top: 150, left: 220, width: 40, height: 20 } as DOMRect,
      {
        top: 100,
        left: 200,
      } as DOMRect,
    );
    // Simulate a 300px scroll: both rects shift up by the same amount.
    const after = toRelativeRect(
      { top: -150, left: 220, width: 40, height: 20 } as DOMRect,
      {
        top: -200,
        left: 200,
      } as DOMRect,
    );
    expect(after).toEqual(before);
  });
});

describe('parseRing / composeRing', () => {
  it('round-trips a token ring', () => {
    const css = composeRing(2, 0, 'success-400');
    expect(css).toBe('0 0 0px 2px var(--we-color-success-400)');
    expect(parseRing(css)).toEqual({ widthPx: 2, blurPx: 0, color: 'success-400' });
  });

  it('recognises the theme accent, with or without a fallback', () => {
    expect(parseRing('0 0 0 2px var(--we-ring-color)')?.color).toBe(RING_THEME_ACCENT);
    expect(parseRing('0 0 0 2px var(--we-ring-color, red)')?.color).toBe(RING_THEME_ACCENT);
    expect(composeRing(2, 4, RING_THEME_ACCENT)).toBe(`0 0 4px 2px ${RING_THEME_ACCENT}`);
  });

  it('keeps unrecognised colors raw, and rejects non-ring shadows', () => {
    expect(parseRing('0 0 0 3px #ff0000')).toEqual({ widthPx: 3, blurPx: 0, color: '#ff0000' });
    expect(parseRing('1px 2px 3px black')).toBeNull();
    // A raw color must not be wrapped in a token var on the way out.
    expect(composeRing(3, 0, 'rgb(1,2,3)')).toBe('0 0 0px 3px rgb(1,2,3)');
  });
});

describe('condition operands', () => {
  const scope: ScopeGroup[] = [
    {
      label: 'Store',
      refs: [{ kind: 'store', path: 'spaceStore.members', label: 'members', valueType: 'array' }],
    } as unknown as ScopeGroup,
  ];

  it('labels each operand kind for a human', () => {
    expect(operandLabel({ kind: 'store', path: 'a.b' })).toBe('a.b');
    expect(operandLabel({ kind: 'literal', value: null })).toBe('null');
    expect(operandLabel({ kind: 'count', items: { kind: 'store', path: 'a.b' } })).toBe('count of a.b');
    expect(operandLabel({ kind: 'formState', token: 'formValid', field: '' })).toBe('all fields are valid');
    expect(operandLabel(undefined)).toBe('');
  });

  it('resolves an operand value type from literals, structure, or scope', () => {
    expect(operandValueType({ kind: 'literal', value: true }, [])).toBe('boolean');
    expect(operandValueType({ kind: 'count', items: { kind: 'store', path: 'x' } }, [])).toBe('number');
    expect(operandValueType({ kind: 'formState', token: 'error', field: 'name' }, [])).toBe('string');
    expect(operandValueType({ kind: 'store', path: 'spaceStore.members' }, scope)).toBe('array');
    expect(operandValueType({ kind: 'store', path: 'unknown.path' }, scope)).toBe('unknown');
  });

  it('refToOperand mirrors the scope ref kind', () => {
    expect(refToOperand({ kind: 'local', path: 'open' } as never)).toEqual({ kind: 'local', path: 'open' });
  });

  it('operandComplete demands substance per kind', () => {
    expect(operandComplete(undefined)).toBe(false);
    expect(operandComplete({ kind: 'store', path: '  ' })).toBe(false);
    expect(operandComplete({ kind: 'literal', value: '' })).toBe(false);
    expect(operandComplete({ kind: 'literal', value: 0 })).toBe(true);
    expect(operandComplete({ kind: 'list', value: [] })).toBe(false);
    expect(operandComplete({ kind: 'count', items: { kind: 'store', path: 'x' } })).toBe(true);
  });

  it('exprComplete: unary needs one side, binary needs both, groups need every child', () => {
    const left = { kind: 'store', path: 'a' } as const;
    expect(exprComplete({ type: 'comparison', operator: 'truthy', left } as ConditionExpr)).toBe(true);
    expect(exprComplete({ type: 'comparison', operator: 'eq', left } as ConditionExpr)).toBe(false);
    expect(
      exprComplete({
        type: 'comparison',
        operator: 'eq',
        left,
        right: { kind: 'literal', value: 1 },
      } as ConditionExpr),
    ).toBe(true);
    expect(exprComplete({ type: 'group', operator: 'and', children: [] } as unknown as ConditionExpr)).toBe(false);
  });
});
