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

/** Parse then serialize — the token must come back byte-identical. */
function roundTrip(token: unknown): unknown {
  const parsed = parseCondition(token);
  expect(parsed, `expected ${JSON.stringify(token)} to be representable`).not.toBeNull();
  return serializeCondition(parsed as ConditionExpr);
}

describe('parseCondition', () => {
  it('reads a bare store reference as a truthy check', () => {
    expect(parseCondition({ $store: 'adamStore.isWeSpace' })).toEqual({
      type: 'comparison',
      operator: 'truthy',
      left: { kind: 'store', path: 'adamStore.isWeSpace' },
    });
  });

  it('reads a bare local reference as a truthy check', () => {
    expect(parseCondition({ $local: 'showComments' })).toEqual({
      type: 'comparison',
      operator: 'truthy',
      left: { kind: 'local', path: 'showComments' },
    });
  });

  it('reads a context reference string as a truthy check', () => {
    expect(parseCondition('$post.highlighted')).toEqual({
      type: 'comparison',
      operator: 'truthy',
      left: { kind: 'context', path: '$post.highlighted' },
    });
  });

  it('reads $not over a reference as a falsy check', () => {
    expect(parseCondition({ $not: { $store: 'userStore.isLoggedIn' } })).toEqual({
      type: 'comparison',
      operator: 'falsy',
      left: { kind: 'store', path: 'userStore.isLoggedIn' },
    });
  });

  it('reads binary comparisons with mixed operand kinds', () => {
    expect(parseCondition({ $eq: [{ $store: 'userStore.role' }, 'admin'] })).toEqual({
      type: 'comparison',
      operator: 'eq',
      left: { kind: 'store', path: 'userStore.role' },
      right: { kind: 'literal', value: 'admin' },
    });
  });

  it('reads $in with a literal list on the right', () => {
    const parsed = parseCondition({ $in: ['$item.role', ['admin', 'moderator']] });
    expect(parsed).toEqual({
      type: 'comparison',
      operator: 'in',
      left: { kind: 'context', path: '$item.role' },
      right: { kind: 'list', value: ['admin', 'moderator'] },
    });
  });

  it('reads a group of comparisons', () => {
    const parsed = parseCondition({
      $and: [{ $store: 'userStore.isAdmin' }, { $not: { $store: 'appStore.isLocked' } }],
    });
    expect(parsed).toMatchObject({ type: 'group', operator: 'and' });
    expect((parsed as { children: unknown[] }).children).toHaveLength(2);
  });

  it('reads one level of nested grouping', () => {
    const parsed = parseCondition({
      $or: [
        { $eq: [{ $store: 'userStore.role' }, 'admin'] },
        { $and: [{ $store: 'userStore.isVerified' }, { $eq: [{ $store: 'userStore.role' }, 'editor'] }] },
      ],
    });
    expect(parsed).not.toBeNull();
    expect((parsed as { children: ConditionExpr[] }).children[1].type).toBe('group');
  });
});

describe('parseCondition — count and validation-state operands', () => {
  it('reads a bare $count as a truthy check', () => {
    expect(parseCondition({ $count: { items: { $local: 'signalTypes' } } })).toEqual({
      type: 'comparison',
      operator: 'truthy',
      left: { kind: 'count', items: { kind: 'local', path: 'signalTypes' } },
    });
  });

  it('reads $count on either side of a comparison', () => {
    expect(parseCondition({ $gt: [{ $count: { items: { $store: 'spaceStore.members' } } }, 0] })).toEqual({
      type: 'comparison',
      operator: 'gt',
      left: { kind: 'count', items: { kind: 'store', path: 'spaceStore.members' } },
      right: { kind: 'literal', value: 0 },
    });
  });

  it('reads the validation-state readers', () => {
    expect(parseCondition({ $formValid: '$scope' })).toMatchObject({
      left: { kind: 'formState', token: 'formValid', field: '$scope' },
    });
    expect(parseCondition({ $touched: 'email' })).toMatchObject({
      left: { kind: 'formState', token: 'touched', field: 'email' },
    });
    expect(parseCondition({ $not: { $valid: 'email' } })).toMatchObject({
      operator: 'falsy',
      left: { kind: 'formState', token: 'valid', field: 'email' },
    });
  });

  it('normalises the legacy $formValid: true spelling to $scope', () => {
    expect(parseCondition({ $formValid: true })).toMatchObject({
      left: { kind: 'formState', token: 'formValid', field: '$scope' },
    });
  });
});

describe('parseCondition — outside the grammar', () => {
  const unsupported: [string, unknown][] = [
    ['$find', { $find: { items: { $store: 'spaceStore.members' }, where: { id: '$item.id' } } }],
    ['$count over a literal', { $count: { items: 3 } }],
    ['$count with extra keys', { $count: { items: { $local: 'x' }, extra: 1 } }],
    ['$concat operand', { $eq: [{ $concat: ['a', 'b'] }, 'ab'] }],
    ['$filter', { $filter: { items: { $store: 'spaceStore.members' }, where: { role: 'admin' } } }],
    ['$not over a comparison', { $not: { $eq: [{ $store: 'a.b' }, 1] } }],
    ['three levels of grouping', { $and: [{ $or: [{ $and: [{ $store: 'a.b' }] }] }] }],
    ['bare literal', 'just a string'],
    ['malformed $eq', { $eq: [{ $store: 'a.b' }] }],
    ['undefined', undefined],
  ];

  it.each(unsupported)('returns null for %s so the raw editor takes over', (_label, token) => {
    expect(parseCondition(token)).toBeNull();
  });
});

describe('serializeCondition', () => {
  const tokens: [string, unknown][] = [
    ['bare store ref', { $store: 'adamStore.isWeSpace' }],
    ['bare local ref', { $local: 'showComments' }],
    ['context ref', '$post.highlighted'],
    ['$not', { $not: { $store: 'userStore.isLoggedIn' } }],
    ['$eq with literal', { $eq: [{ $store: 'userStore.role' }, 'admin'] }],
    ['$ne with two refs', { $ne: [{ $store: 'a.b' }, { $local: 'c' }] }],
    ['$gt with number', { $gt: [{ $store: 'listStore.itemCount' }, 0] }],
    ['$lt with number', { $lt: [{ $local: 'count' }, 5] }],
    ['$in with list', { $in: ['$item.role', ['admin', 'moderator']] }],
    ['$not over $in', { $not: { $in: [{ $local: 'contentType' }, ['posts', 'users']] } }],
    ['bare $count', { $count: { items: { $local: 'signalTypes' } } }],
    ['$gt over $count', { $gt: [{ $count: { items: { $store: 'spaceStore.members' } } }, 0] }],
    ['$formValid', { $formValid: '$scope' }],
    ['$error', { $error: 'email' }],
    ['$not over $valid', { $not: { $valid: 'email' } }],
    ['$and mixing count and validation state', { $and: [{ $count: { items: { $local: 'x' } } }, { $touched: 'y' }] }],
    ['$eq with boolean', { $eq: [{ $local: 'flag' }, true] }],
    ['$eq with null', { $eq: [{ $store: 'a.b' }, null] }],
    ['$and group', { $and: [{ $store: 'userStore.isAdmin' }, { $not: { $store: 'appStore.isLocked' } }] }],
    [
      'nested $or/$and',
      {
        $or: [
          { $eq: [{ $store: 'userStore.role' }, 'admin'] },
          { $and: [{ $store: 'userStore.isVerified' }, { $eq: [{ $store: 'userStore.role' }, 'editor'] }] },
        ],
      },
    ],
  ];

  it.each(tokens)('round-trips %s unchanged', (_label, token) => {
    expect(roundTrip(token)).toEqual(token);
  });
});

describe('value positions', () => {
  it('parses the tokens that appear in children', () => {
    expect(parseValue({ $store: 'spaceStore.currentSpace.name' })).toEqual({
      kind: 'store',
      path: 'spaceStore.currentSpace.name',
    });
    expect(parseValue('$agent.firstName')).toEqual({ kind: 'context', path: '$agent.firstName' });
    expect(parseValue('Shared')).toEqual({ kind: 'literal', value: 'Shared' });
  });

  it('returns null for expressions with no picker equivalent', () => {
    expect(parseValue({ $concat: ['a', 'b'] })).toBeNull();
    expect(parseValue({ $plural: { count: 1, one: 'x', other: 'y' } })).toBeNull();
  });

  it('round-trips value tokens', () => {
    for (const token of [{ $store: 'a.b' }, { $local: 'x' }, '$item.name', 'plain', 42, true, null]) {
      expect(serializeValue(parseValue(token)!)).toEqual(token);
    }
  });

  it('recognises a prop-level $if in a value position', () => {
    const token = {
      $if: {
        condition: { $eq: [{ $store: 'spaceStore.currentSpace.access' }, 'shared'] },
        then: 'Shared',
        else: 'Personal',
      },
    };
    const parsed = parseValueIf(token);
    expect(parsed).toEqual({ condition: token.$if.condition, then: 'Shared', else: 'Personal' });
    expect(serializeValueIf(parsed!)).toEqual(token);
  });

  it('omits an absent else rather than writing undefined', () => {
    const token = { $if: { condition: { $local: 'open' }, then: 'Yes' } };
    expect(serializeValueIf(parseValueIf(token)!)).toEqual(token);
  });

  it('rejects node-level $if shapes so the raw editor keeps them', () => {
    // Transitions only exist on the renderer operator, not the value form.
    expect(parseValueIf({ $if: { condition: true, then: 'a', enterTransition: { type: 'fade' } } })).toBeNull();
    expect(parseValueIf({ $if: { condition: true } })).toBeNull();
    expect(parseValueIf({ type: '$if', props: { condition: true, then: {} } })).toBeNull();
  });
});

describe('content shapes', () => {
  const cases: [string, unknown[] | undefined, string][] = [
    ['no children', undefined, 'text'],
    ['empty children', [], 'text'],
    ['a plain string', ['About this space'], 'text'],
    ['a store binding', [{ $store: 'spaceStore.currentSpace.name' }], 'value'],
    ['a context ref', ['$agent.firstName'], 'text'],
    ['a value-level $if', [{ $if: { condition: { $local: 'x' }, then: 'a', else: 'b' } }], 'conditional'],
    ['a $concat', [{ $concat: ['a', 'b'] }], 'custom'],
    ['several parts', ['Hello ', { $store: 'a.b' }], 'custom'],
  ];

  it.each(cases)('classifies %s', (_label, children, expected) => {
    expect(classifyContent(children)).toBe(expected);
  });

  it('reads a context ref string as text, since that is how it is authored', () => {
    // '$agent.firstName' is a bare string in children — the text field round-trips it.
    expect(contentAsText('$agent.firstName')).toBe('$agent.firstName');
  });

  it('collapses a conditional to its then branch when converting to text', () => {
    expect(contentAsText({ $if: { condition: { $local: 'x' }, then: 'Shared', else: 'Personal' } })).toBe('Shared');
  });

  it('has no text reading for a binding or a custom expression', () => {
    expect(contentAsText({ $store: 'a.b' })).toBe('');
    expect(contentAsText({ $concat: ['a'] })).toBe('');
    expect(contentAsText({ $if: { condition: true, then: { $store: 'a.b' } } })).toBe('');
  });
});

describe('editing helpers', () => {
  it('marks a fresh comparison as blank', () => {
    expect(isBlankComparison(emptyComparison())).toBe(true);
  });

  it('does not mark a populated comparison as blank', () => {
    expect(isBlankComparison(parseCondition({ $local: 'open' }) as ConditionExpr)).toBe(false);
  });
});
