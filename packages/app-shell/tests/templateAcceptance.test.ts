/**
 * What a template has to be before WE will render it.
 *
 * The two things this catches arrive by the same door and neither was ever opted into: a shared
 * space's templates sync in with the space, so visiting one is enough to render whatever its
 * members wrote.
 */
import { describe, expect, it } from 'vitest';

import { CHROME_TIER, inspectTemplateSurface, SPACE_TIER } from '../src/shared/registries/templateSurface';
import { acceptTemplate } from '../src/shared/templateAcceptance';

const meta = { name: 'Test', description: 'A template', icon: 'star' };

/** The smallest thing that passes structural validation, so a case can add exactly one problem. */
const wellFormed = (children: unknown[] = []) => ({ type: 'Column', meta, children });

describe('a schema that would take the app down', () => {
  it('refuses a node whose children are not nodes', () => {
    const { schema, refusals } = acceptTemplate(
      { type: 'Column', meta, children: 'not an array' },
      {
        origin: 'a space',
      },
    );

    expect(schema).toBeNull();
    expect(refusals.length).toBeGreaterThan(0);
  });

  it('refuses a node whose props are not an object', () => {
    expect(acceptTemplate({ type: 'Column', meta, props: ['nope'] }, { origin: 'a space' }).schema).toBeNull();
  });

  it('refuses a route tree that is not a list of routes', () => {
    expect(acceptTemplate({ type: 'Column', meta, routes: 'nope' }, { origin: 'a space' }).schema).toBeNull();
  });

  it('refuses something that is not an object at all', () => {
    expect(acceptTemplate('a string', { origin: 'a space' }).schema).toBeNull();
    expect(acceptTemplate(null, { origin: 'a space' }).schema).toBeNull();
    expect(acceptTemplate([], { origin: 'a space' }).schema).toBeNull();
  });

  it('accepts an ordinary template', () => {
    const { schema, refusals, blocked } = acceptTemplate(wellFormed(), { origin: 'a space' });

    expect(schema).not.toBeNull();
    expect(refusals).toEqual([]);
    expect(blocked).toEqual([]);
  });
});

describe('a schema reaching past its tier', () => {
  const signOutButton = wellFormed([
    { type: 'we-button', props: { onClick: { $action: 'sessionStore.logout' } }, children: ['Sign out'] },
  ]);

  it('admits it rather than refusing, and names what will not work', () => {
    // The reference is already inert — `buildTemplateBag` never puts it in the bag. Refusing the
    // whole template over one button would throw away the ninety-nine nodes that were fine; what
    // was missing is anybody being told.
    const { schema, blocked } = acceptTemplate(signOutButton, { origin: 'a space', grants: SPACE_TIER });

    expect(schema).not.toBeNull();
    expect(blocked.map((b) => b.path)).toEqual(['sessionStore.logout']);
    expect(blocked[0].group).toBe('session');
  });

  it('allows the same reference for chrome, which is what the tiers are for', () => {
    expect(acceptTemplate(signOutButton, { origin: 'chrome', grants: CHROME_TIER }).blocked).toEqual([]);
  });

  it('defaults to the space tier, so an unspecified caller gets the safe answer', () => {
    expect(acceptTemplate(signOutButton, { origin: 'a space' }).blocked).toHaveLength(1);
  });
});

describe('finding the references at all', () => {
  it('finds one nested in an operator, a handler array and a route', () => {
    // References are not in a fixed place. A walk that knew the node shape would need revising for
    // every operator added, and a missed reference is one nobody inspected.
    const schema = {
      type: 'Column',
      meta,
      routes: [
        {
          path: '/',
          type: 'Column',
          children: [
            {
              type: 'we-button',
              props: {
                disabled: { $: 'runtimeStore.loading ? true : null' },
                onClick: [{ $setLocal: 'x', value: 1 }, { $action: 'runtimeStore.restartExecutor' }],
              },
            },
          ],
        },
      ],
    };

    const { blocked } = inspectTemplateSurface(schema, SPACE_TIER);
    expect(blocked.map((b) => b.path).sort()).toEqual(['runtimeStore.loading', 'runtimeStore.restartExecutor']);
  });

  it('reports each distinct reference once however many times it appears', () => {
    const repeated = wellFormed(
      Array.from({ length: 5 }, () => ({ type: 'we-text', props: { text: { $: 'sessionStore.bootState' } } })),
    );

    expect(inspectTemplateSurface(repeated, SPACE_TIER).blocked).toHaveLength(1);
  });

  it('does not block the renderer bindings or a module store', () => {
    // `modules.<id>.<key>` is the documented way to depend on an optional module, and its members
    // cannot be classified here — which module ids exist depends on the deployment's seed.
    const schema = wellFormed([
      { type: 'we-text', props: { text: { $: 'modules.notes.open' } } },
      { type: 'we-text', props: { text: { $: { $: 'me.did' } } } },
    ]);

    expect(inspectTemplateSurface(schema, SPACE_TIER).blocked).toEqual([]);
  });

  it('blocks a store nobody has classified, rather than admitting it', () => {
    // An undecided member is not an open one. Reported with a null group so a caller can word
    // "there is no such thing" differently from "you may not have that".
    const schema = wellFormed([{ type: 'we-text', props: { text: { $: 'inventedStore.secrets' } } }]);
    const { blocked } = inspectTemplateSurface(schema, SPACE_TIER);

    expect(blocked).toHaveLength(1);
    expect(blocked[0].group).toBeNull();
  });

  it('judges a deep path by its store and member, as the bag does', () => {
    // `spaceStore.currentSpace.name` — the bag filters members, and everything under one travels
    // with it, so only the first two segments can decide.
    const schema = wellFormed([{ type: 'we-text', props: { text: { $: 'spaceStore.currentSpace.name' } } }]);

    expect(inspectTemplateSurface(schema, SPACE_TIER).blocked).toEqual([]);
  });

  it('reports the groups a template actually uses, for an install prompt', () => {
    const schema = wellFormed([
      { type: 'we-text', props: { text: { $: 'spaceStore.currentSpace.name' } } },
      { type: 'we-button', props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } } },
    ]);

    expect(inspectTemplateSurface(schema, SPACE_TIER).groups.sort()).toEqual(['content', 'navigation']);
  });
});
