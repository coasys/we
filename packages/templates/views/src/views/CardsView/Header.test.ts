/**
 * The header's Call button and the one rule about it: a call already running is joined, never
 * forked.
 *
 * It used to invoke `startCall` the moment you were not in a call — which, pressed in a space whose
 * sidebar was closed, minted a second call beside the one running and split the meeting. The button
 * is now the affordance the review asked for: "Join call · N" while presence shows a call here and
 * you are not in it, "Go to call" while you are, and only "Call" — a start — when nothing is
 * running to join.
 */
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { cardsHeader } from './Header';

/** Every node in a tree, so a test can ask about a subtree without knowing where it sits. */
function walk(node: unknown, out: SchemaNode[] = []): SchemaNode[] {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const record = node as Record<string, unknown>;
  if (typeof record.type === 'string') out.push(record as unknown as SchemaNode);
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') walk(value, out);
  }
  return out;
}

const props = (node: SchemaNode | undefined): Record<string, unknown> => (node?.props ?? {}) as Record<string, unknown>;

/** The button whose action is a call action — the header's one route into the module. */
const callButton = (): SchemaNode =>
  walk(cardsHeader).find(
    (node) => node.type === 'we-button' && JSON.stringify(props(node).onClick).includes('modules.call.'),
  ) as SchemaNode;

/** One `$if` handler branch: `{ $if: { condition, then } }`, as a handler array holds them. */
type Branch = { $if: { condition: { $: string }; then: unknown } };

describe('the header’s Call button', () => {
  it('says "Join call · N" while a call runs here and you are not in it', () => {
    // The affordance itself: a call on is named, counted, and one press away — in the header,
    // where it is visible whether or not the sidebar is drawn.
    const text = JSON.stringify(props(callButton()).text);
    expect(text).toContain('Join call');
    expect(text).toContain('count(modules.call.liveCalls)');
    expect(text).toContain('first(modules.call.liveCalls).count');
  });

  it('joins the running call and never starts a second one beside it', () => {
    /*
      `startCall` may only be reached when `liveCalls` is empty — any other arrangement is the bug.
      Asserted on the shape rather than the branch order: a re-ordering that kept the gates would
      still be right, and one that dropped either would fork a meeting.
    */
    const branches = props(callButton()).onClick as Branch[];
    const goTo = branches.find((branch) => JSON.stringify(branch.$if.then).includes('goToCall'));
    const start = branches.find((branch) => JSON.stringify(branch.$if.then).includes('startCall'));

    expect(goTo, 'no branch reaches goToCall').toBeDefined();
    expect(JSON.stringify(goTo!.$if.condition)).toContain('count(modules.call.liveCalls)');
    expect(start, 'no branch reaches startCall').toBeDefined();
    expect(JSON.stringify(start!.$if.condition)).toContain('!count(modules.call.liveCalls)');
  });
});
