/**
 * A comment's time and a transcript line's time are the same stamp.
 *
 * Both surfaces are a line of conversation with who said it and when, and they are written in two
 * packages that cannot see each other: `agentByline` is in `@we/template-kit`, the transcript row is
 * in `@we/module-transcribe`, and neither may depend on the other. So they drifted — the comment's
 * time was drawn at the size of the name beside it, where the transcript's is a coordinate you skim
 * past to find a moment.
 *
 * This is the only place both are in scope. It compares the two DECLARATIONS rather than restating
 * the values, so it fails whichever side moves — which a number written down in one of them could
 * not do.
 */
import { transcriptLines } from '@we/module-transcribe';
import type { SchemaNode } from '@we/schema-shared';
import { agentByline } from '@we/template-kit';
import { describe, expect, it } from 'vitest';

/** Every node in a schema tree, branches and slots included. */
function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return void node.forEach((n) => walk(n, visit));
  const n = node as Record<string, unknown>;
  if (typeof n.type === 'string' || n.props || n.children) visit(n);
  for (const value of Object.values(n)) walk(value, visit);
}

/** The first `we-timestamp` in a tree, as the props it was declared with. */
function stamp(tree: unknown): Record<string, unknown> | undefined {
  let found: Record<string, unknown> | undefined;
  walk(tree, (n) => {
    if (n.type === 'we-timestamp' && !found) found = (n.props ?? {}) as Record<string, unknown>;
  });
  return found;
}

describe('the time on a line of conversation', () => {
  const comment = stamp(
    agentByline({
      did: { $: 'reply.author' },
      timestamp: { $: 'reply.createdAt' },
      compact: true,
    }) as SchemaNode,
  );
  const utterance = stamp(transcriptLines);

  it('is found on both surfaces, so nothing below is vacuous', () => {
    expect(comment, 'no time in a compact byline').toBeTruthy();
    expect(utterance, 'no time on a transcript line').toBeTruthy();
  });

  it.each(['fontSize', 'color', 'fontWeight', 'relativeStyle'])('agrees about %s', (key) => {
    expect(comment![key]).toEqual(utterance![key]);
  });

  /*
    `relative` is the one thing they differ about, deliberately.

    A transcript's rows are minutes apart inside one meeting, so the useful coordinate is the clock
    and "6 days ago" would be the same string forty times — it turns relative on only while the call
    is live. A thread is not one sitting, and how long ago somebody replied is the thing worth
    reading. Asserted so the difference stays a decision rather than becoming the next drift.
  */
  it('but not about whether it is relative', () => {
    expect(comment!.relative).toBe(true);
    expect(utterance!.relative).not.toBe(true);
  });
});
