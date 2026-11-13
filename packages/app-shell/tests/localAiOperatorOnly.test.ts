/**
 * Settings → This device: installing, starting, stopping and removing local AI are the operator's.
 *
 * The executor refuses those four calls to anything but the operator credential, and a grant never
 * is one, whatever its capabilities. WE web connects with such a grant, so the actions must not be
 * drawn there: a button that always answers 403 is worse than no button. A connection that is not
 * the operator reads one line saying who can set local AI up instead.
 *
 * Asserted against the schema, as `localAiRemoveDialog` is: which branch a node sits in is the fact.
 */
import { settingsTemplate } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

type Node = Record<string, unknown>;

/** Every node, with the `$if` branches above it: the condition, and whether it is the `then` side. */
interface Placed {
  node: Node;
  branches: { condition: string; side: 'then' | 'else' }[];
}

function walk(node: unknown, branches: Placed['branches'] = [], out: Placed[] = []): Placed[] {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, branches, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const record = node as Node;
  out.push({ node: record, branches });
  for (const key of ['children', 'routes']) walk(record[key], branches, out);
  const props = record.props as Node | undefined;
  if (props && record.type === '$if') {
    const condition = JSON.stringify(props.condition ?? '');
    walk(props.then, [...branches, { condition, side: 'then' }], out);
    walk(props.else, [...branches, { condition, side: 'else' }], out);
  }
  return out;
}

const placed = walk(settingsTemplate);
const ACTIONS = ['installLocalAi', 'startLocalAi', 'stopLocalAi', 'removeLocalAi'];
const OPERATOR = 'runtimeStore.canConfigureLocalAi';

/** The controls that call an action: their own handler names it, not a branch somewhere below them. */
const invoking = (action: string) =>
  placed.filter(({ node }) =>
    JSON.stringify((node.props as Node | undefined)?.onClick ?? '').includes(`runtimeStore.${action}`),
  );

describe('Settings → This device → the operator’s actions', () => {
  it.each(ACTIONS)('draws %s only where the connection is the operator', (action) => {
    const nodes = invoking(action);
    expect(nodes.length).toBeGreaterThan(0);
    for (const { branches } of nodes) {
      expect(branches.some((b) => b.side === 'then' && b.condition.includes(OPERATOR))).toBe(true);
    }
  });

  it('offers the rest of the plan once part of it is installed', () => {
    // A partial install (one service the backend installed by itself, or an install of some kinds)
    // makes `installed` true. Install must still be reachable then, or only Remove gets the rest.
    const offersRest = (b: Placed['branches'][number]) =>
      b.side === 'then' && /runtimeStore\.localAi\.installed && runtimeStore\.localAi\.incomplete/.test(b.condition);
    const rest = invoking('installLocalAi').filter(({ branches }) => branches.some(offersRest));
    expect(rest.length).toBeGreaterThan(0);
    // Still the operator's, as every other install is.
    for (const { branches } of rest) {
      expect(branches.some((b) => b.side === 'then' && b.condition.includes(OPERATOR))).toBe(true);
    }
  });

  it('tells a connection that is not the operator who can set local AI up', () => {
    const lines = placed.filter(
      ({ node, branches }) =>
        JSON.stringify(node).includes('Set up local AI in the ADAM launcher on this node, or ask its operator.') &&
        branches.some((b) => b.side === 'else' && b.condition.includes(OPERATOR)),
    );
    expect(lines.length).toBeGreaterThan(0);
  });
});
