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

describe('BlockComposer save handshake', () => {
  /**
   * The composer is pull-based: `onSave` fires when the `save()` handed out by `onReady` is called.
   * `onSave` alone is a handler nothing triggers — and since `onReady` is optional, the composer
   * quietly renders a save button of its own instead. The showcase templates shipped this once and
   * it surfaced only on submit, as a null deref inside `persistNode`.
   */
  it('rejects onSave without onReady', () => {
    const node: SchemaNode = {
      type: 'BlockComposer',
      props: { onSave: { $setLocal: 'draft', from: '$arg' } },
    } as SchemaNode;
    expect(messages(node, 'error').join(' ')).toMatch(/onSave.*but no "onReady"/);
  });

  it('accepts the pair', () => {
    const node: SchemaNode = {
      type: 'Column',
      $localState: { savePost: { type: 'function', initial: null } },
      children: [
        {
          type: 'BlockComposer',
          props: {
            onReady: { $setLocal: 'savePost', from: '$event.save' },
            onSave: { $action: 'spaceStore.createPost', args: ['$arg'] },
          },
        },
      ],
    } as SchemaNode;
    expect(messages(node, 'error')).toEqual([]);
  });

  it('leaves a composer with neither alone — read-only previews are legitimate', () => {
    const node: SchemaNode = { type: 'BlockComposer', props: { width: '100%' } } as SchemaNode;
    expect(messages(node, 'error')).toEqual([]);
  });
});

describe('tokens sitting directly in a children array', () => {
  /**
   * `children` legitimately accepts tokens — a `$plural` count-noun label is written that way, and
   * so is a `$store` name. But a token is not a node, and walking it as one dropped it into the
   * grouping-node branch, which looks for routes and children and finds neither. So every store
   * path, action name and `$local` reference inside a token in a children array went unexamined:
   * move the same expression from a prop into children and the validator stopped having an opinion.
   */
  it('catches an unknown store member inside a children token', () => {
    const node: SchemaNode = {
      type: 'we-text',
      children: [{ $store: 'spaceStore.noSuchMember' }],
    } as SchemaNode;
    expect(messages(node, 'error').concat(messages(node, 'warning')).join(' ')).toMatch(/noSuchMember/);
  });

  it('catches an undeclared $local inside a children token', () => {
    const node: SchemaNode = {
      type: 'Column',
      $localState: { other: { type: 'string', initial: '' } },
      children: [{ type: 'we-text', children: [{ $local: 'missing' }] }],
    } as SchemaNode;
    expect(messages(node, 'error').join(' ')).toMatch(/\$local references "missing"/);
  });

  it('catches a bad expression nested inside a $plural count', () => {
    const node: SchemaNode = {
      type: 'Column',
      $localState: { rows: { type: 'object', initial: null } },
      children: [
        {
          type: 'we-text',
          children: [{ $plural: { count: { $local: 'notDeclared' }, one: 'reply', other: 'replies' } }],
        },
      ],
    } as SchemaNode;
    expect(messages(node, 'error').join(' ')).toMatch(/\$local references "notDeclared"/);
  });

  it('still accepts a well-formed token in children', () => {
    const node: SchemaNode = {
      type: 'Column',
      $localState: { rows: { type: 'object', initial: null } },
      children: [
        {
          type: 'we-text',
          children: [{ $plural: { count: { $local: 'rows' }, one: 'reply', other: 'replies' } }],
        },
      ],
    } as SchemaNode;
    expect(messages(node, 'error')).toEqual([]);
  });

  it('does not mistake a node carrying $localState for a token', () => {
    const node: SchemaNode = {
      type: 'Column',
      children: [
        {
          type: 'Column',
          $localState: { open: { type: 'boolean', initial: false } },
          children: [{ type: 'we-text', props: { text: { $local: 'open' } } }],
        },
      ],
    } as SchemaNode;
    expect(messages(node, 'error')).toEqual([]);
  });
});

describe('breakpoint tiers', () => {
  it('accepts the tier bags on any component, layout-only ones included', () => {
    // They are not a DS *layer* — a layer answers "which kinds of property does this element
    // accept", and a tier is a condition under which any of them apply. So a we-icon may be laid
    // out differently at a different width even though it takes no visual props at all.
    expect(messages({ type: 'Column', props: { mdUpProps: { gap: '500' } } }, 'warning')).toEqual([]);
    expect(messages({ type: 'we-icon', props: { lgUpProps: { width: '32px' } } }, 'warning')).toEqual([]);
    expect(messages({ type: 'we-text', props: { smUpProps: { fontSize: '400' } } }, 'warning')).toEqual([]);
  });

  it('points at the right spelling when someone drops the Up', () => {
    // The likely mistake, and worth catching: `md` is already a size value on some fifteen
    // primitives, so `mdProps` reads as "medium-size props" and is not what these are called.
    const warnings = messages({ type: 'Column', props: { mdProps: { gap: '500' } } }, 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('did you mean "mdUpProps"');
  });
});
