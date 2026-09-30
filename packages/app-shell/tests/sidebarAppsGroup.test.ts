/**
 * The Apps group is gated on the *external* apps, and lists those plus WE.
 *
 * The asymmetry is deliberate and reads like a slip, which is exactly why it is pinned here.
 * `appStore.appsWithWe` prepends a `WE` sentinel whose row means "get back out of an app" — so it is
 * never empty, and a guard counting the list it iterates is a guard that is always true. That was
 * the real behaviour until this test's change: a deployment configuring no apps still rendered an
 * "Apps" heading over a single "WE" row that did nothing.
 *
 * Tidying the two references into agreement is the obvious edit for anyone who meets this cold, and
 * nothing about it fails — the group simply comes back in every app-less deployment, which is now
 * all of them.
 */
import { sidebar } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

type Node = Record<string, unknown>;

/** Every node in the tree, including the branches an `$if` carries in its props. */
function walk(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const record = node as Node;
  out.push(record);
  for (const key of ['children', 'routes', 'then', 'else']) walk(record[key], out);
  const props = record.props as Node | undefined;
  if (props) {
    walk(props.then, out);
    walk(props.else, out);
    walk(props.header, out);
    walk(props.footer, out);
  }
  return out;
}

const nodes = walk(sidebar);

/** The loop that renders one row per app, found by what it iterates. */
const appsLoop = nodes.find((node) => {
  const items = (node.props as Node | undefined)?.items as Node | undefined;
  return node.type === '$each' && items?.$ === 'appStore.appsWithWe';
});

describe('sidebar Apps group', () => {
  it('lists WE alongside the external apps', () => {
    // The sentinel belongs in the *rows*: inside an app, it is how you get back to WE.
    expect(appsLoop, 'the apps loop should iterate appsWithWe').toBeDefined();
  });

  it('renders at all only when there is an external app', () => {
    /*
      Counted against `apps`, never `appsWithWe`. The question "should this group exist" is about
      whether there is an app to switch to; the sentinel is a way back, not a destination, so it must
      not be able to hold the group open on its own.
    */
    /*
      The *innermost* enclosing `$if`, by subtree size. Several contain this loop — the whole rail
      sits behind a boot-state gate — so taking the first match found walking down would assert
      against "is the agent signed in", which is true of every node in the file.
    */
    const gate = nodes
      .filter((node) => node.type === '$if' && walk((node.props as Node | undefined)?.then).includes(appsLoop as Node))
      .sort((a, b) => walk(a).length - walk(b).length)[0];

    expect(gate, 'the Apps group must be behind an $if').toBeDefined();
    expect((gate?.props as Node).condition).toEqual({ $: 'count(appStore.apps)' });
  });
});
