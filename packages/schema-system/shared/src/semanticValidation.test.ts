import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildValidationContext, validateSemantic } from './semanticValidation';
import type { SchemaNode } from './types';

// The same generated context the CLI reads, loaded the same way — this package deliberately does
// not depend on `@we/ai-context` (it is a build tool, and the dependency would point the wrong way).
const contextData = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../ai-context/context.json'), 'utf-8'));
const context = buildValidationContext(contextData);

/** Validate a fragment (no `meta`), which is how a section of a template is judged. */
function check(node: SchemaNode) {
  return validateSemantic(node, context);
}

function messages(node: SchemaNode, severity: 'error' | 'warning') {
  return check(node)
    .errors.filter((e) => e.severity === severity)
    .map((e) => e.message);
}

/**
 * These cover the failure class this validator exists for: schemas that render, accept input, and
 * quietly do the wrong thing. Every case below shipped in WE's own templates at some point.
 */
describe('$map select references', () => {
  it('rejects a bare $item, which resolves to a literal', () => {
    const node: SchemaNode = {
      type: 'AvatarStack',
      props: {
        avatars: { $map: { items: { $store: 'spaceStore.members' }, select: { hash: '$item' } } },
      },
    };
    const errs = messages(node, 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('resolved as a literal');
    expect(errs[0]).toContain('$concat');
  });

  it('accepts a dotted $item path, and a token object', () => {
    const node: SchemaNode = {
      type: 'AvatarStack',
      props: {
        avatars: {
          $map: {
            items: { $store: 'spaceStore.members' },
            select: { image: '$item.avatar', hash: { $concat: ['$item'] } },
          },
        },
      },
    };
    expect(messages(node, 'error')).toEqual([]);
  });

  it('warns about any other $-prefixed string in a select', () => {
    const node: SchemaNode = {
      type: 'AvatarStack',
      props: {
        avatars: { $map: { items: { $store: 'spaceStore.members' }, select: { hash: '$person.did' } } },
      },
    };
    expect(messages(node, 'warning').join()).toContain('passed through as a literal');
  });

  it('checks tokens inside the source expression', () => {
    const node: SchemaNode = {
      type: 'AvatarStack',
      props: {
        avatars: { $map: { items: { $store: 'spaceStore.definitelyNotAMember' }, select: { hash: '$item.did' } } },
      },
    };
    // The source used to be read from a key the grammar does not have (`source`), so nothing in it
    // was ever checked.
    expect(messages(node, 'warning').join()).toContain('definitelyNotAMember');
  });
});

describe('writes to hoisted query results', () => {
  const listNode = (write: Record<string, unknown>): SchemaNode => ({
    type: 'Column',
    $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
    children: [{ type: 'we-button', props: { onClick: write }, children: ['Go'] }],
  });

  it('rejects $setLocal against a $queries name', () => {
    const errs = messages(listNode({ $setLocal: 'signalTypes', value: [] }), 'error');
    expect(errs.join()).toContain('read-only');
  });

  it('rejects $toggleLocal against a $queries name', () => {
    const errs = messages(listNode({ $toggleLocal: 'signalTypes' }), 'error');
    expect(errs.join()).toContain('read-only');
  });

  it('allows reads of the same name', () => {
    const node: SchemaNode = {
      type: 'Column',
      $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
      children: [{ type: 'we-text', children: [{ $count: { items: { $local: 'signalTypes' } } }] }],
    };
    expect(messages(node, 'error')).toEqual([]);
  });

  it('allows a write once $localState shadows the query name', () => {
    const node: SchemaNode = {
      type: 'Column',
      $queries: { items: { entity: 'SignalType', subscribe: true } },
      children: [
        {
          type: 'Column',
          $localState: { items: { type: 'object', initial: null } },
          children: [{ type: 'we-button', props: { onClick: { $setLocal: 'items', value: null } }, children: ['x'] }],
        },
      ],
    };
    expect(messages(node, 'error')).toEqual([]);
  });
});

describe('undeclared local writes', () => {
  it('rejects $toggleLocal against a field nothing declares', () => {
    const node: SchemaNode = {
      type: 'Column',
      $localState: { open: { type: 'boolean', initial: false } },
      children: [{ type: 'we-button', props: { onClick: { $toggleLocal: 'opne' } }, children: ['x'] }],
    };
    expect(messages(node, 'error').join()).toContain('opne');
  });

  it('rejects $callLocal against a field nothing declares', () => {
    const node: SchemaNode = {
      type: 'Column',
      $localState: { onConfirm: { type: 'function', initial: null } },
      children: [{ type: 'we-button', props: { onClick: { $callLocal: 'onConfrim' } }, children: ['x'] }],
    };
    expect(messages(node, 'error').join()).toContain('onConfrim');
  });
});

describe('local scope across a route boundary', () => {
  /**
   * `buildRoutes` renders each route through its own `RenderSchema` call, so a route subtree
   * inherits no context — `$localState` and `$queries` on the template root are invisible below a
   * `$routes` outlet. The validator used to carry the parent scope across, which made it *approve*
   * reads that resolve to nothing: the showcase Timeline template hoisted its `signalTypes` query
   * onto the root, validated clean, and rendered no signal controls at all.
   *
   * The reads are in `props` because that is where the real ones were (a `$count` guard and a
   * `$find` inside a query projection) — and because a token sitting directly in a `children` array
   * is not walked at all, which is a separate gap this does not pretend to cover.
   */
  const template = (routes: unknown): SchemaNode =>
    ({
      meta: { name: 'T', description: 'd', icon: 'bug' },
      type: 'Column',
      $queries: { signalTypes: { entity: 'SignalType' } },
      $localState: { draft: { type: 'string', initial: '' } },
      children: [{ type: '$routes' }],
      routes,
    }) as SchemaNode;

  const readsSignalTypes = { type: 'we-text', props: { text: { $local: 'signalTypes' } } };

  it('rejects a route reading a $queries entry declared on the root', () => {
    const node = template([{ path: '/', type: 'Column', children: [readsSignalTypes] }]);
    expect(messages(node, 'error').join(' ')).toMatch(/\$local references "signalTypes"/);
  });

  it('rejects a route reading a $localState field declared on the root', () => {
    const node = template([
      { path: '/', type: 'Column', children: [{ type: 'we-text', props: { text: { $local: 'draft' } } }] },
    ]);
    expect(messages(node, 'error').join(' ')).toMatch(/\$local references "draft"/);
  });

  it('accepts the same read when the route declares it itself', () => {
    const node = template([
      {
        path: '/',
        type: 'Column',
        $queries: { signalTypes: { entity: 'SignalType' } },
        children: [readsSignalTypes],
      },
    ]);
    expect(messages(node, 'error')).toEqual([]);
  });

  it('still lets a route’s own declaration reach its nested children', () => {
    const node = template([
      {
        path: '/',
        type: 'Column',
        $localState: { open: { type: 'boolean', initial: false } },
        children: [{ type: 'Column', children: [{ type: 'we-text', props: { text: { $local: 'open' } } }] }],
      },
    ]);
    expect(messages(node, 'error')).toEqual([]);
  });
});
