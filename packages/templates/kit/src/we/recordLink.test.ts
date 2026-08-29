import { describe, expect, it } from 'vitest';

import { RECORD_ROUTE_PATH, recordLink } from './recordLink.ts';

/**
 * What the link actually points at.
 *
 * This exists because the href was wrong twice and looked right both times. It is built by
 * interpolating into a template string, so TypeScript and the schema validator are equally happy
 * with `/record/:entity/:id` and `/record/:entity?id=…` — nothing but a running app or this test can
 * tell you which one it emits. The route only matches the second: a record id is `ad4m://obj/<x>`,
 * a URI, so as a path segment it is several segments and nothing matches it.
 */
describe('recordLink', () => {
  const node = recordLink({ $: "'CollectionBlock'" }, { $: 'post.id' }) as Record<string, never>;
  const button = (node as unknown as { props: { then: { props: Record<string, { $: string }> } } }).props.then.props;

  it('puts the id in the query, never in the path', () => {
    expect(button.href.$).toBe("`${spaceStore.spacePath}/record/${'CollectionBlock'}?id=${post.id}`");
  });

  it('builds its path out of the route it targets', () => {
    /*
      The drift this feature actually shipped, twice: the route said `/record/:entity/:recordId` and
      the link said something else, and no layer of the toolchain can tell. They are one literal now
      — this asserts the derivation still holds, so a change to the route moves the link with it.
    */
    const expected = RECORD_ROUTE_PATH.replace(':entity', "${'CollectionBlock'}");
    expect(button.href.$).toContain(expected);
  });

  it('builds an absolute path from the space it is in', () => {
    // A relative href resolves against the current URL rather than the route tree, so it is right
    // from a section's index and wrong from any sub-route of one.
    expect(button.href.$.startsWith('`${spaceStore.spacePath}/')).toBe(true);
  });
});
