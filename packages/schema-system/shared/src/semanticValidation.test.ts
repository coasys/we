import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { asHostChrome, buildValidationContext, validateSemantic, withEntities } from './semanticValidation';
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
describe('map projections', () => {
  it('accepts a projection over a known store member', () => {
    const node: SchemaNode = {
      type: 'AvatarStack',
      props: { avatars: { $: 'spaceStore.members.map(m, { image: m.avatar, hash: m.did })' } },
    };
    expect(messages(node, 'error')).toEqual([]);
  });

  it('rejects a name the comprehension did not bind', () => {
    // With `meta` the schema is a whole template, so an unbound name has nowhere else to come from.
    const node = {
      meta: { name: 'T', description: 'd', icon: 'users' },
      type: 'AvatarStack',
      props: { avatars: { $: 'spaceStore.members.map(m, { hash: person.did })' } },
    } as SchemaNode;
    expect(messages(node, 'error').join()).toContain('person');
  });

  it('checks the source the projection reads from', () => {
    const node: SchemaNode = {
      type: 'AvatarStack',
      props: { avatars: { $: 'spaceStore.definitelyNotAMember.map(m, { hash: m.did })' } },
    };
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
      children: [{ type: 'we-text', children: [{ $: 'count(local.signalTypes)' }] }],
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
   * The reads are in `props` because that is where the real ones were (a `count()` guard and a
   * `find()` inside a query projection).
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

  const readsSignalTypes = { type: 'we-text', props: { text: { $: 'local.signalTypes' } } };

  it('rejects a route reading a $queries entry declared on the root', () => {
    const node = template([{ path: '/', type: 'Column', children: [readsSignalTypes] }]);
    expect(messages(node, 'error').join(' ')).toMatch(/signalTypes/);
  });

  it('rejects a route reading a $localState field declared on the root', () => {
    const node = template([
      { path: '/', type: 'Column', children: [{ type: 'we-text', props: { text: { $: 'local.draft' } } }] },
    ]);
    expect(messages(node, 'error').join(' ')).toMatch(/draft/);
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
        children: [{ type: 'Column', children: [{ type: 'we-text', props: { text: { $: 'local.open' } } }] }],
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
      props: { onSave: { $setLocal: 'draft', value: { $: 'arg' } } },
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
            onReady: { $setLocal: 'savePost', value: { $: 'event.save' } },
            onSave: { $invoke: 'spaceStore.createPost', args: [{ $: 'arg' }] },
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

describe('a node type that renders one child, given several', () => {
  /**
   * `$each` renders `children[0]` and drops the rest in silence. `commentThread` built each row as
   * two nodes — the reply, then the thread under it — so every level of every thread below the first
   * was expanded, validated and never mounted, and the only symptom was a reply to a reply appearing
   * nowhere at all.
   */
  it('rejects an $each with more than one child', () => {
    const node: SchemaNode = {
      type: '$each',
      props: { items: { $: 'local.rows' }, as: 'row' },
      children: [
        { type: 'we-text', children: [{ $: 'row.title' }] },
        { type: 'we-text', children: ['dropped, silently'] },
      ],
    } as SchemaNode;
    expect(messages(node, 'error').join(' ')).toMatch(/renders only its first child/);
  });

  it('rejects an $animate wrapping several', () => {
    const node: SchemaNode = {
      type: '$animate',
      props: { scrollReveal: true },
      children: [
        { type: 'we-text', children: ['a'] },
        { type: 'we-text', children: ['b'] },
      ],
    } as SchemaNode;
    expect(messages(node, 'error').join(' ')).toMatch(/renders only its first child/);
  });

  it('accepts the row wrapped in one box', () => {
    const node: SchemaNode = {
      type: '$each',
      props: { items: { $: 'local.rows' }, as: 'row' },
      children: [
        {
          type: 'Column',
          children: [
            { type: 'we-text', children: [{ $: 'row.title' }] },
            { type: 'we-text', children: ['and everything under it'] },
          ],
        },
      ],
    } as SchemaNode;
    expect(messages(node, 'error')).toEqual([]);
  });
});

describe('expressions sitting directly in a children array', () => {
  /**
   * `children` legitimately accepts an expression — a count-noun label is written that way. But a
   * token is not a node, and walking it as one dropped it into the grouping-node branch, which
   * looks for routes and children and finds neither. So every store path and local reference
   * inside an expression in a children array went unexamined: move the same expression from a
   * prop into children and the validator stopped having an opinion.
   */
  it('catches an unknown store member inside a children expression', () => {
    const node: SchemaNode = {
      type: 'we-text',
      children: [{ $: 'spaceStore.noSuchMember' }],
    } as SchemaNode;
    expect(messages(node, 'error').concat(messages(node, 'warning')).join(' ')).toMatch(/noSuchMember/);
  });

  it('catches an undeclared local inside a children expression', () => {
    const node: SchemaNode = {
      type: 'Column',
      $localState: { other: { type: 'string', initial: '' } },
      children: [{ type: 'we-text', children: [{ $: 'local.missing' }] }],
    } as SchemaNode;
    expect(messages(node, 'error').join(' ')).toMatch(/missing/);
  });

  it('catches a bad reference nested inside a plural() count', () => {
    const node: SchemaNode = {
      type: 'Column',
      $localState: { rows: { type: 'object', initial: null } },
      children: [
        {
          type: 'we-text',
          children: [{ $: "plural(count(local.notDeclared), 'reply', 'replies')" }],
        },
      ],
    } as SchemaNode;
    expect(messages(node, 'error').join(' ')).toMatch(/notDeclared/);
  });

  it('still accepts a well-formed expression in children', () => {
    const node: SchemaNode = {
      type: 'Column',
      $localState: { rows: { type: 'object', initial: null } },
      children: [
        {
          type: 'we-text',
          children: [{ $: "plural(count(local.rows), 'reply', 'replies')" }],
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
          children: [{ type: 'we-text', props: { text: { $: 'local.open' } } }],
        },
      ],
    } as SchemaNode;
    expect(messages(node, 'error')).toEqual([]);
  });

  it('rejects a reference written as a string', () => {
    const node: SchemaNode = {
      type: 'we-text',
      props: { text: '$item.title' },
      children: ['$me.did'],
    } as SchemaNode;
    const errs = messages(node, 'error');
    expect(errs.join(' ')).toMatch(/old string spelling/);
    expect(errs).toHaveLength(2);
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

  /*
    An offset in a tier bag is accepted by every check an author has and read by nothing.

    Both bags resolve through one pipeline over `INTERACTIVE_SPECS`, which excludes positioning —
    see "what the state and tier axes cover" in `@we/design-utils`, which pins that exclusion from
    the other side. The bag is a `Partial<DesignSystemProps>`, so it typechecks; the prop is a real
    DS prop, so it validated; and an unwritten variable renders as the base value, which is exactly
    what a breakpoint that has not been crossed looks like.
  */
  it('refuses an offset in a tier or state bag, and says what to use instead', () => {
    for (const bag of ['mdUpProps', 'hoverProps']) {
      const errors = messages({ type: 'Column', props: { [bag]: { left: '300px' } } }, 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('does not vary by state or breakpoint');
      expect(errors[0]).toContain('"x", "y" or "rotate"');
    }
  });

  it('leaves an offset alone outside a bag, where it works', () => {
    expect(messages({ type: 'Column', props: { position: 'absolute', left: '300px' } }, 'error')).toEqual([]);
  });

  it('still accepts what a tier does carry', () => {
    // `x`/`y`/`rotate` compose into `transform`, which IS on the interactive surface — the whole
    // point of the message above.
    expect(messages({ type: 'Column', props: { mdUpProps: { x: 300, width: '50%' } } }, 'error')).toEqual([]);
  });
});

describe('"open" on a panel that supplies its own node', () => {
  /*
    The failure class this validator exists for, in its purest form: a field that typechecks,
    validates, reads exactly as intended and is never consulted.

    `open` suppresses a MODULE launcher — the call module's is `goToCall`, which joins a call when
    there is not one, so `open: false` is what lets an interface place the call window without
    starting a call for whoever walks in. An authored panel has no launcher to suppress: the host
    places it and it is up. The shell reads the flag under a `panel.module &&` guard and there is no
    second read site, so on a `node` entry it does nothing at all.

    It shipped that way in the workshop template, which declared its calls list `open: false` and
    got a panel that was always open — and was never wrong on screen, which is exactly why nobody
    noticed for as long as they did.
  */
  const shell = (panel: Record<string, unknown>): SchemaNode =>
    ({
      meta: { name: 'T', description: 'D', icon: 'i', panels: [panel] },
      type: 'Column',
      props: { bg: 'page' },
    }) as unknown as SchemaNode;

  it('warns when an authored panel declares it', () => {
    const warnings = messages(shell({ id: 'notes', node: { type: 'Column' }, open: false }), 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"module"');
  });

  it('warns on `open: true` as well — it is equally unread, not merely redundant', () => {
    expect(messages(shell({ id: 'notes', node: { type: 'Column' }, open: true }), 'warning')).toHaveLength(1);
  });

  it('says nothing about a module panel, which is what the field is for', () => {
    expect(messages(shell({ id: 'call', module: 'call', open: false }), 'warning')).toEqual([]);
  });

  it('says nothing about an authored panel that leaves it alone', () => {
    expect(messages(shell({ id: 'notes', node: { type: 'Column' } }), 'warning')).toEqual([]);
  });

  it('warns rather than refuses, so a stranger’s template still installs', () => {
    const result = check(shell({ id: 'notes', node: { type: 'Column' }, open: false }));
    expect(result.valid).toBe(true);
  });
});

describe('a query over several entities', () => {
  it('checks each name in a literal list, and points at the one that is wrong', () => {
    const node: SchemaNode = {
      type: 'Column',
      $queries: { found: { entity: ['TaskBlock', 'EvntBlock'] } },
    };
    const errors = check(node).errors.filter((e) => e.severity === 'error');
    expect(errors.map((e) => e.message)).toEqual(['Unknown model "EvntBlock" in $query. Did you mean "EventBlock"?']);
    expect(errors[0].path).toContain('entity[1]');
  });

  it('leaves an expression answering with a list to runtime', () => {
    const node: SchemaNode = {
      type: 'Column',
      $localState: { kinds: { type: 'array', initial: [] } },
      $queries: { found: { entity: { $: 'local.kinds' } } },
    };
    expect(messages(node, 'error')).toEqual([]);
  });
});

/**
 * `gap: '050'` shipped in six places and was never a token: the scale goes 0, 100, 200. It resolved
 * to a variable nothing declares, so there was no gap, and the prop's type — `SpaceValue`, a string —
 * gave this validator nothing to compare against.
 */
describe('space values', () => {
  it('rejects a number that is not a step of the scale, wherever it is written', () => {
    for (const props of [
      { gap: '050' },
      { p: '050' },
      { mdUpProps: { px: '250' } },
      { gap: { $: "local.open ? '400' : '050'" } },
    ]) {
      const errors = messages(
        { type: 'Column', props, $localState: { open: { type: 'boolean', initial: false } } },
        'error',
      );
      expect(errors, JSON.stringify(props)).toHaveLength(1);
      expect(errors[0]).toContain('is not a space token');
    }
  });

  it('accepts steps, theme families where the axis has them, and CSS', () => {
    const node: SchemaNode = {
      type: 'Column',
      props: {
        gap: 'surface',
        p: '400',
        mt: '-8px',
        top: 'calc(100% - 4px)',
        left: 'auto',
        mdUpProps: { gap: '0', px: 'var(--we-space-300)' },
      },
    };
    expect(messages(node, 'error')).toEqual([]);
  });

  it('rejects a family on an axis that has none', () => {
    // A family says how much room a box puts inside itself, which answers nothing about a margin.
    expect(messages({ type: 'Column', props: { m: 'surface' } }, 'error')).toHaveLength(1);
  });
});

describe('a write wired to an event nobody causes', () => {
  const unasked = (node: SchemaNode) => messages(node, 'warning').filter((m) => m.includes('fires without anybody'));
  const create = { $invoke: 'record.create', args: ['TaskBlock', { title: 'x' }] };

  it('warns when an image loading would write', () => {
    expect(unasked({ type: 'img', props: { src: 'a.png', onLoad: create } })).toHaveLength(1);
  });

  it('finds the write inside a handler list and inside a lifecycle callback', () => {
    const nested = { $invoke: 'routeStore.navigate', args: ['/'], onSuccess: [create] };
    expect(unasked({ type: 'details', props: { onToggle: [{ $setLocal: 'x', value: 1 }, nested] } })).toHaveLength(1);
  });

  it('says nothing about the same write on a press', () => {
    expect(unasked({ type: 'we-button', props: { onClick: create } })).toEqual([]);
  });

  it('says nothing about an action that may run unasked', () => {
    expect(
      unasked({ type: 'img', props: { src: 'a.png', onLoad: { $invoke: 'routeStore.navigate', args: ['/'] } } }),
    ).toEqual([]);
    expect(unasked({ type: 'Grid', props: { onArrange: { $invoke: 'modules.call.setArrangement' } } })).toEqual([]);
  });

  it('says nothing about a blur, which counts as asking once somebody typed', () => {
    expect(unasked({ type: 'we-input', props: { onBlur: create } })).toEqual([]);
  });
});

describe('a dialog asking about what the host asks about anyway', () => {
  const twice = (node: SchemaNode, ctx = context) =>
    validateSemantic(node, ctx)
      .errors.filter((e) => e.severity === 'warning')
      .map((e) => e.message)
      .filter((m) => m.includes('two questions about one click'));
  const sheet = (children: unknown[]) =>
    ({ type: '$if', props: { condition: { $: 'true' }, then: { type: 'we-modal', children } } }) as SchemaNode;
  const deleteButton = {
    type: 'we-button',
    props: { onClick: { $invoke: 'spaceStore.deleteCollection', args: ['c1'] } },
  };

  it('warns about a confirmation in front of a delete', () => {
    expect(twice(sheet([{ type: 'we-text', children: ['Delete this?'] }, deleteButton]))).toHaveLength(1);
  });

  it('says nothing about a delete pressed directly, which is the shape it asks for', () => {
    expect(twice(deleteButton as SchemaNode)).toEqual([]);
  });

  it('says nothing about a form whose Delete sits beside fields', () => {
    expect(twice(sheet([{ type: 'we-input', props: { value: 'x' } }, deleteButton]))).toEqual([]);
  });

  it('says nothing in host chrome, where no confirmation is raised for it', () => {
    expect(twice(sheet([deleteButton]), asHostChrome(context))).toEqual([]);
  });
});

describe('native elements outside the allowlist', () => {
  const errors = (node: SchemaNode) =>
    messages(node, 'error').filter((m) => m.includes('not an element a template may mount'));

  it('reports a script or an iframe, which render nothing', () => {
    expect(errors({ type: 'script', children: ['x'] })).toHaveLength(1);
    expect(errors({ type: 'Column', children: [{ type: 'iframe', props: { srcdoc: 'x' } }] })).toHaveLength(1);
  });

  it('says nothing about an element on the list', () => {
    expect(errors({ type: 'div', children: [{ type: 'img', props: { src: 'a.png', alt: '' } }] })).toEqual([]);
  });
});

describe('comparing an included relation as if it were an id', () => {
  const included = (m: string) => m.includes('is the included') || m.includes('compares the included');
  const listOf = (expression: string, include = true): SchemaNode => ({
    type: 'Column',
    $queries: {
      events: { entity: 'EventBlock', ...(include ? { include: { location: true } } : {}), limit: 20 },
    },
    children: [{ type: 'we-text', children: [{ $: expression }] }],
  });

  it('warns about a comprehension comparing the relation itself', () => {
    expect(
      messages(listOf("count(local.events.filter(e, e.location == 'p1'))"), 'warning').filter(included),
    ).toHaveLength(1);
  });

  it('warns about a where-object keyed by the relation', () => {
    expect(messages(listOf("find(local.events, { location: 'p1' }).title"), 'warning').filter(included)).toHaveLength(
      1,
    );
  });

  it('says nothing when the comparison reads the id', () => {
    expect(
      messages(listOf("count(local.events.filter(e, e.location.id == 'p1'))"), 'warning').filter(included),
    ).toEqual([]);
  });

  it('says nothing when the query does not include the relation, where it is an id', () => {
    expect(
      messages(listOf("count(local.events.filter(e, e.location == 'p1'))", false), 'warning').filter(included),
    ).toEqual([]);
  });
});

describe('withEntities', () => {
  it('teaches a context kinds of record it did not know, without touching the original', () => {
    const query: SchemaNode = { type: 'Column', $queries: { rows: { entity: 'Sighting', limit: 5 } } };
    const unknown = (ctx: typeof context) =>
      validateSemantic(query, ctx).errors.filter((e) => e.message.includes('Sighting')).length;
    expect(unknown(context)).toBeGreaterThan(0);
    expect(unknown(withEntities(context, ['Sighting']))).toBe(0);
    expect(context.entityNames.has('Sighting')).toBe(false);
  });
});

/*
  Tokens inside the plain data a prop holds — a globe's layer entries, a menu's items — went
  unchecked: the prop walk opened lists and never an object's own fields, so a misspelt local or
  module member one level into an entry passed and showed up only as a control that did nothing.
*/
describe('tokens inside the data a prop holds', () => {
  const template = (children: SchemaNode[]) =>
    ({
      meta: { name: 'T', description: 'd', icon: 'globe' },
      type: 'Column',
      $localState: { showA: { type: 'boolean', initial: true } },
      children,
    }) as SchemaNode;

  it('checks a layer entry’s expressions and handlers', () => {
    const errors = messages(
      template([
        {
          type: 'CesiumGlobe',
          props: {
            planetLayers: [
              {
                factory: 'pointsLayer',
                enabled: { $: 'local.showB' },
                options: { onSelect: { $setLocal: 'picked', value: { $: 'event' } } },
              },
            ],
          },
        },
      ]),
      'error',
    ).join('\n');
    expect(errors).toContain('local.showB');
    expect(errors).toContain('"picked"');
  });

  it('checks a menu entry’s, inside a group too', () => {
    const errors = messages(
      template([
        {
          type: 'DropdownMenu',
          props: {
            items: [
              {
                type: 'group',
                id: 'g',
                label: 'G',
                hidden: { $: '!modules.globe.drawsSpacez' },
                items: [
                  {
                    type: 'toggle',
                    id: 'x',
                    label: 'X',
                    checked: { $: 'local.showC' },
                    onToggle: { $toggleLocal: 'showD' },
                  },
                ],
              },
            ],
          },
        },
      ]),
      'error',
    ).join('\n');
    expect(errors).toContain('drawsSpacez');
    expect(errors).toContain('local.showC');
    expect(errors).toContain('"showD"');
  });

  it('passes the same entries when every name is right', () => {
    expect(
      messages(
        template([
          { type: 'CesiumGlobe', props: { planetLayers: [{ factory: 'pointsLayer', enabled: { $: 'local.showA' } }] } },
          {
            type: 'DropdownMenu',
            props: {
              items: [
                {
                  type: 'toggle',
                  id: 'a',
                  label: 'A',
                  checked: { $: 'local.showA' },
                  hidden: { $: '!modules.globe.drawsSpace' },
                },
              ],
            },
          },
        ]),
        'error',
      ),
    ).toEqual([]);
  });

  it('does not judge a subtree a prop holds against the scope outside it', () => {
    // A node held in a prop is rendered by its component, which may bind names the scope outside
    // it has never heard of. Data is opened; a subtree is left to whatever renders it.
    const node = template([
      { type: 'GraphView', props: { emptyAction: { type: 'Row', children: [{ $: 'row.title' }] } } },
    ]);
    expect(messages(node, 'error')).toEqual([]);
  });
});

describe('a template’s own record views', () => {
  const template = (recordViews: Record<string, unknown>) =>
    ({
      type: 'Column',
      meta: { name: 't', description: '', icon: 'x', recordViews },
      children: [],
    }) as unknown as SchemaNode;

  it('checks each view as a node of the template', () => {
    const result = validateSemantic(template({ TaskBlock: { type: 'we-nonexistent' } }), context);
    expect(result.errors.some((e) => e.path.startsWith('meta.recordViews.TaskBlock'))).toBe(true);
  });

  it('refuses a key the record page cannot match', () => {
    const result = validateSemantic(template({ 'task block': { type: 'Column' } }), context);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain('meta.recordViews.task block');
  });

  it('accepts an entity, an entity with a kind, and a view named by id', () => {
    const result = validateSemantic(
      template({
        TaskBlock: { type: 'Column' },
        'CollectionBlock:call': { type: 'Column' },
        Proposal: 'proposal-page',
      }),
      context,
    );
    expect(result.errors.filter((e) => e.path.startsWith('meta.recordViews'))).toEqual([]);
  });
});

/*
  Boards, Twitter, YouTube, Instagram and Discord each opened a record with `./board/${board.id}`.
  A record id is a URI, so the browser split it across segments, the route never matched, and every
  detail page opened on its fallback. Nothing said so anywhere.
*/
describe('a record id in the path of an address', () => {
  const PUT_IN_PATH = 'A record id is put into the path';
  const go = (to: unknown, ...rest: unknown[]): SchemaNode => ({
    type: 'we-button',
    props: { onClick: { $invoke: 'routeStore.navigate', args: [to, ...rest] } },
  });
  const warned = (node: SchemaNode) => messages(node, 'warning').some((m) => m.startsWith(PUT_IN_PATH));

  it('is warned about, however the path is built', () => {
    expect(warned(go({ $: '`./board/${board.id}`' }))).toBe(true);
    expect(warned(go({ $: "'./photo/' + media.id" }))).toBe(true);
    expect(warned(go({ $: "'./channel/' + local.channelId" }))).toBe(true);
    expect(warned({ type: 'we-link', props: { href: { $: '`/post/${post.id}`' } } })).toBe(true);
  });

  it('is not warned about as a query value, or when what the path holds is no id', () => {
    expect(warned(go('./board', { $: '{ query: { id: board.id } }' }))).toBe(false);
    expect(warned(go({ $: '`./board?id=${board.id}`' }))).toBe(false);
    expect(warned(go({ $: '`/space/${space.uuid}/${nav.segment}`' }))).toBe(false);
    expect(warned(go('./board'))).toBe(false);
  });
});

/*
  A relative path is from the route the node is in (`resolvePath`). Five templates wrote `.` inside a
  route meaning "home", which is that route itself, so their back buttons did nothing.
*/
describe('a relative path that goes nowhere useful', () => {
  const button = (to: string): SchemaNode => ({
    type: 'we-button',
    props: { onClick: { $invoke: 'routeStore.navigate', args: [to] } },
  });
  const template = (route: SchemaNode, chrome: SchemaNode[] = []) =>
    ({
      meta: { name: 'T', description: 'd', icon: 'users' },
      type: 'Column',
      children: [...chrome, { type: '$routes' }],
      routes: [{ path: '/board', type: 'Column', children: [route] }],
    }) as unknown as SchemaNode;
  const warned = (node: SchemaNode, words: string) => messages(node, 'warning').some((m) => m.includes(words));
  const SELF = 'goes to the page it is on';
  const CLIMB = 'climbs above the template';

  it('is warned about as . inside a route, or as a link to it', () => {
    expect(warned(template(button('.')), SELF)).toBe(true);
    expect(warned(template({ type: 'we-link', props: { href: './' } }), SELF)).toBe(true);
  });

  it('is warned about when it climbs above the template’s root', () => {
    expect(warned(template(button('../..')), CLIMB)).toBe(true);
    expect(warned(template({ type: 'Column' }, [button('../wall')]), CLIMB)).toBe(true);
  });

  it('is fine as the template’s root, the page above, a child, or . in chrome', () => {
    for (const to of ['~/', '~/wall', '..', '../wall', './cards']) {
      expect(warned(template(button(to)), SELF) || warned(template(button(to)), CLIMB), to).toBe(false);
    }
    expect(warned(template({ type: 'Column' }, [button('.')]), SELF)).toBe(false);
  });

  it('counts a section as a route, and leaves a fragment’s .. alone', () => {
    const view = { ...(button('..') as object), meta: { name: 'V', description: 'd', icon: 'x', role: 'view' } };
    expect(warned(view as SchemaNode, CLIMB)).toBe(false);
    expect(warned(button('../..'), CLIMB)).toBe(false);
  });
});
