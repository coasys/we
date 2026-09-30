import { describe, expect, it } from 'vitest';

import type { ConditionExpr } from './conditionModel';
import {
  classifyContent,
  contentAsText,
  emptyComparison,
  isBlankComparison,
  parseCondition,
  parseValue,
  parseValueIf,
  serializeCondition,
  serializeValue,
  serializeValueIf,
} from './conditionModel';

/** Parse then serialize — the expression must come back byte-identical. */
function roundTrip(source: string): unknown {
  const parsed = parseCondition({ $: source });
  expect(parsed, `expected ${source} to be representable`).not.toBeNull();
  return serializeCondition(parsed as ConditionExpr);
}

describe('parseCondition', () => {
  it('reads a bare store reference as a truthy check', () => {
    expect(parseCondition({ $: 'sessionStore.isWeSpace' })).toEqual({
      type: 'comparison',
      operator: 'truthy',
      left: { kind: 'store', path: 'sessionStore.isWeSpace' },
    });
  });

  it('reads a bare local reference as a truthy check', () => {
    expect(parseCondition({ $: 'local.showComments' })).toEqual({
      type: 'comparison',
      operator: 'truthy',
      left: { kind: 'local', path: 'showComments' },
    });
  });

  it('reads a context reference as a truthy check', () => {
    expect(parseCondition({ $: 'post.highlighted' })).toEqual({
      type: 'comparison',
      operator: 'truthy',
      left: { kind: 'context', path: 'post.highlighted' },
    });
  });

  it('reads a negated reference as a falsy check', () => {
    expect(parseCondition({ $: '!userStore.isLoggedIn' })).toEqual({
      type: 'comparison',
      operator: 'falsy',
      left: { kind: 'store', path: 'userStore.isLoggedIn' },
    });
  });

  it('reads binary comparisons with mixed operand kinds', () => {
    expect(parseCondition({ $: "userStore.role == 'admin'" })).toEqual({
      type: 'comparison',
      operator: 'eq',
      left: { kind: 'store', path: 'userStore.role' },
      right: { kind: 'literal', value: 'admin' },
    });
  });

  it('reads `in` with a literal list on the right', () => {
    expect(parseCondition({ $: "item.role in ['admin', 'moderator']" })).toEqual({
      type: 'comparison',
      operator: 'in',
      left: { kind: 'context', path: 'item.role' },
      right: { kind: 'list', value: ['admin', 'moderator'] },
    });
  });

  it('reads a group of comparisons', () => {
    const parsed = parseCondition({ $: 'userStore.isAdmin && !appStore.isLocked' });
    expect(parsed).toMatchObject({ type: 'group', operator: 'and' });
    expect((parsed as { children: unknown[] }).children).toHaveLength(2);
  });

  it('flattens a chain of the same connective into one group', () => {
    const parsed = parseCondition({ $: 'a.x && b.y && c.z' });
    expect((parsed as { children: unknown[] }).children).toHaveLength(3);
  });

  it('reads one level of nested grouping', () => {
    const parsed = parseCondition({
      $: "userStore.role == 'admin' || (userStore.isVerified && userStore.role == 'editor')",
    });
    expect(parsed).not.toBeNull();
    expect((parsed as { children: ConditionExpr[] }).children[1].type).toBe('group');
  });
});

describe('parseCondition — count and validation-state operands', () => {
  it('reads a bare count() as a truthy check', () => {
    expect(parseCondition({ $: 'count(local.signalTypes)' })).toEqual({
      type: 'comparison',
      operator: 'truthy',
      left: { kind: 'count', items: { kind: 'local', path: 'signalTypes' } },
    });
  });

  it('reads count() on either side of a comparison, in either call spelling', () => {
    expect(parseCondition({ $: 'count(spaceStore.members) > 0' })).toEqual({
      type: 'comparison',
      operator: 'gt',
      left: { kind: 'count', items: { kind: 'store', path: 'spaceStore.members' } },
      right: { kind: 'literal', value: 0 },
    });
    expect(parseCondition({ $: 'spaceStore.members.count() > 0' })).toMatchObject({
      left: { kind: 'count', items: { kind: 'store', path: 'spaceStore.members' } },
    });
  });

  it('reads the validation-state readers', () => {
    expect(parseCondition({ $: 'formValid()' })).toMatchObject({
      left: { kind: 'formState', token: 'formValid', field: '$scope' },
    });
    expect(parseCondition({ $: "touched('email')" })).toMatchObject({
      left: { kind: 'formState', token: 'touched', field: 'email' },
    });
    expect(parseCondition({ $: "!valid('email')" })).toMatchObject({
      operator: 'falsy',
      left: { kind: 'formState', token: 'valid', field: 'email' },
    });
  });
});

describe('parseCondition — outside the grammar', () => {
  const unsupported: [string, unknown][] = [
    ['find()', { $: 'find(spaceStore.members, { id: item.id })' }],
    ['count over a literal', { $: 'count(3)' }],
    ['count with extra arguments', { $: 'count(local.x, 1)' }],
    ['an interpolation operand', { $: "`${a}b` == 'ab'" }],
    ['filter()', { $: "filter(spaceStore.members, { role: 'admin' })" }],
    ['a negated comparison', { $: '!(a.b == 1)' }],
    ['arithmetic', { $: 'local.page + 1 > 3' }],
    ['three levels of grouping', { $: 'a.b && (c.d || (e.f && g.h))' }],
    ['a comprehension', { $: 'local.rows.exists(r, r.done)' }],
    ['a bare literal', 'just a string'],
    ['a syntax error', { $: 'local.page +' }],
    ['undefined', undefined],
  ];

  it.each(unsupported)('returns null for %s so the raw editor takes over', (_label, token) => {
    expect(parseCondition(token)).toBeNull();
  });
});

describe('serializeCondition', () => {
  const sources = [
    'sessionStore.isWeSpace',
    'local.showComments',
    'post.highlighted',
    '!userStore.isLoggedIn',
    "userStore.role == 'admin'",
    'a.b != local.c',
    'listStore.itemCount > 0',
    'local.count < 5',
    "item.role in ['admin', 'moderator']",
    "!(local.contentType in ['posts', 'users'])",
    'count(local.signalTypes)',
    'count(spaceStore.members) > 0',
    'formValid()',
    "error('email')",
    "!valid('email')",
    "count(local.x) && touched('y')",
    'local.flag == true',
    'a.b == null',
    'userStore.isAdmin && !appStore.isLocked',
    "userStore.role == 'admin' || (userStore.isVerified && userStore.role == 'editor')",
  ];

  it.each(sources)('round-trips %s unchanged', (source) => {
    expect(roundTrip(source)).toEqual({ $: source });
  });
});

describe('value positions', () => {
  it('parses the expressions that appear in children', () => {
    expect(parseValue({ $: 'spaceStore.currentSpace.name' })).toEqual({
      kind: 'store',
      path: 'spaceStore.currentSpace.name',
    });
    expect(parseValue({ $: 'agent.firstName' })).toEqual({ kind: 'context', path: 'agent.firstName' });
    expect(parseValue('Shared')).toEqual({ kind: 'literal', value: 'Shared' });
  });

  it('returns null for expressions with no picker equivalent', () => {
    expect(parseValue({ $: '`${a}b`' })).toBeNull();
    expect(parseValue({ $: "plural(1, 'x', 'y')" })).toBeNull();
  });

  it('round-trips value tokens', () => {
    for (const token of [{ $: 'a.b' }, { $: 'local.x' }, { $: 'item.name' }, 'plain', 42, true, null]) {
      expect(serializeValue(parseValue(token)!)).toEqual(token);
    }
  });

  it('recognises a ternary in a value position', () => {
    const token = { $: "spaceStore.currentSpace.access == 'shared' ? 'Shared' : 'Personal'" };
    const parsed = parseValueIf(token);
    expect(parsed).toEqual({
      condition: { $: "spaceStore.currentSpace.access == 'shared'" },
      then: 'Shared',
      else: 'Personal',
    });
    expect(serializeValueIf(parsed!)).toEqual(token);
  });

  it('reads a null alternate as an absent else', () => {
    const token = { $: "local.open ? 'Yes' : null" };
    expect(parseValueIf(token)).toEqual({ condition: { $: 'local.open' }, then: 'Yes' });
    expect(serializeValueIf(parseValueIf(token)!)).toEqual(token);
  });

  it('rejects branches the picker cannot represent', () => {
    expect(parseValueIf({ $: 'local.open ? `${a}` : 1' })).toBeNull();
    expect(parseValueIf({ $: 'local.open' })).toBeNull();
    expect(parseValueIf({ type: '$if', props: { condition: true, then: {} } })).toBeNull();
  });
});

describe('content shapes', () => {
  const cases: [string, unknown[] | undefined, string][] = [
    ['no children', undefined, 'text'],
    ['empty children', [], 'text'],
    ['a plain string', ['About this space'], 'text'],
    ['a store binding', [{ $: 'spaceStore.currentSpace.name' }], 'value'],
    ['a context ref', [{ $: 'agent.firstName' }], 'value'],
    ['a ternary', [{ $: "local.x ? 'a' : 'b'" }], 'conditional'],
    ['an interpolation', [{ $: '`${a} ${b}`' }], 'custom'],
    ['several parts', ['Hello ', { $: 'a.b' }], 'custom'],
  ];

  it.each(cases)('classifies %s', (_label, children, expected) => {
    expect(classifyContent(children)).toBe(expected);
  });

  it('collapses a conditional to its then branch when converting to text', () => {
    expect(contentAsText({ $: "local.x ? 'Shared' : 'Personal'" })).toBe('Shared');
  });

  it('has no text reading for a binding or a custom expression', () => {
    expect(contentAsText({ $: 'a.b' })).toBe('');
    expect(contentAsText({ $: '`${a}`' })).toBe('');
    expect(contentAsText({ $: 'local.x ? a.b : null' })).toBe('');
  });
});

describe('editing helpers', () => {
  it('marks a fresh comparison as blank', () => {
    expect(isBlankComparison(emptyComparison())).toBe(true);
  });

  it('does not mark a populated comparison as blank', () => {
    expect(isBlankComparison(parseCondition({ $: 'local.open' }) as ConditionExpr)).toBe(false);
  });
});
