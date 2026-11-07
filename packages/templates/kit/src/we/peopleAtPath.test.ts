/**
 * What `peopleAtPath` builds, and the three decisions in it that are wrong in ways you cannot see.
 *
 * A fragment is data, so the assertions are about the expression it produces — which is exactly where
 * the mistakes live: a selector that quietly unions people across spaces, an exact match that drops
 * somebody the moment they open a card, and a reserved width that reads as a rendering fault for as long
 * as nobody is there.
 */
import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { peopleAtPath } from './peopleAtPath.ts';

const node = peopleAtPath({ path: { $: 'spaceStore.spacePath' }, edge: 'var(--we-role-surface)' });

/** Every expression string anywhere in the node, since a fragment is a tree of them. */
function expressions(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) expressions(entry, out);
    return out;
  }
  if (typeof value !== 'object' || value === null) return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$' && typeof entry === 'string') out.push(entry);
    else expressions(entry, out);
  }
  return out;
}

describe('peopleAtPath', () => {
  it('takes no room at all when nobody is there', () => {
    /*
      A bare `$if`, with no box around it holding a width. The pill this sits in is content-sized, so a
      reserved width does stop its buttons shifting as people move — and nobody being there is the
      ordinary state, which made that reserve a permanent gap at the end of every button.
    */
    expect(node.type).toBe('$if');
    expect(node.props?.condition).toBeTruthy();
    expect(node.props?.width).toBeUndefined();
  });

  it('asks the roster that is already scoped to this space', () => {
    /*
      `online`, never `peers`. A path is only meaningful within a dataset and two spaces routinely have
      the same one, so filtering `peers` by path unions people across every space this agent has
      something live in — which `presence.ts` refuses to offer a selector for, and which a template can
      still reach for by hand.
    */
    const all = expressions(node).join(' ');
    expect(all).toContain('presenceStore.online');
    expect(all).not.toContain('presenceStore.peers');
  });

  it('matches the path as a prefix, and leaves this agent out', () => {
    const all = expressions(node).join(' ');
    // A route has pages beneath it, and somebody reading a card opened from the canvas is still on the
    // canvas as far as a nav strip goes. An exact match drops them the moment they open anything.
    expect(all).toContain('startsWith(p.focus.path');
    // The strip already says where you are by marking the page you are on — from any of your computers.
    expect(all).toContain('!(p.did in me.dids)');
  });

  it('leaves out my other computer, and keeps somebody else on it', () => {
    /*
      Presence is per device: my laptop left open on the canvas beats as its own peer. Comparing to
      `me.did` alone drew it as a face beside my own marker — me, twice, looking like a visitor.
    */
    const here = expressions(node).find((source) => source.startsWith('presenceStore.online.filter('));
    expect(here).toBeDefined();
    const peer = (did: string, person: string, path: string) => ({ did, person, name: did, focus: { path } });
    const roots: Record<string, unknown> = {
      me: {
        did: 'did:key:z6MkTestDesktop',
        dids: ['did:key:z6MkTestDesktop', 'did:key:z6MkTestLaptop', 'did:scid:test:1:QmTestMe'],
      },
      spaceStore: { spacePath: '/s/test/canvas' },
      presenceStore: {
        online: [
          peer('did:key:z6MkTestLaptop', 'did:scid:test:1:QmTestMe', '/s/test/canvas'),
          peer('did:key:z6MkTestAna', 'did:key:z6MkTestAna', '/s/test/canvas/card-1'),
          peer('did:key:z6MkTestBen', 'did:key:z6MkTestBen', '/s/test/feed'),
        ],
      },
    };
    const found = evaluateExpression(parseExpression(here!), {
      root: (name) => ({ bound: name in roots, value: roots[name] }),
      call: (name, args) =>
        listFunctions()
          .find((f) => f.name === name)
          ?.impl(args, { context: {}, stores: {} }),
    }) as { did: string }[];
    expect(found.map((p) => p.did)).toEqual(['did:key:z6MkTestAna']);
  });

  it('seeds each face on the person rather than the name', () => {
    const all = expressions(node).join(' ');
    // `hash` is what keeps two people whose profiles have not arrived from being two identical blank
    // discs — and seeding on a name would recolour somebody when they renamed themselves. The person,
    // not the device, so somebody on two computers is one colour wherever they are seen.
    expect(all).toContain('hash: p.person');
  });
});
