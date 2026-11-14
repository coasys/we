/**
 * Settings → Bots says, where a bot's grant is edited, that other apps can change it.
 *
 * Widening a grant or resuming a paused bot does not open the identity window: any app the person
 * let manage their identity may do it, as the executor's `bot.setGrant` allows. The page has to say
 * so, or the person reads the grant as theirs alone to change.
 */
import * as shell from '@we/template-shell';
import { describe, expect, it } from 'vitest';

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

/** The first node anywhere under `value` that `match` accepts. */
function find(value: unknown, match: (node: Node) => boolean, seen = new Set<unknown>()): Node | undefined {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  if (!Array.isArray(value) && match(value as Node)) return value as Node;
  for (const child of Object.values(value)) {
    const hit = find(child, match, seen);
    if (hit) return hit;
  }
  return undefined;
}

const isText = (text: string) => (n: Node) => n.type === 'we-text' && n.children?.[0] === text;

describe('the bot grant editor', () => {
  it('says that apps allowed to manage the identity can change the grant without asking', () => {
    const editor = find(
      shell,
      (n) => n.type === 'Column' && !!n.children?.some((c) => isText('Permissions')(c as Node)),
    );
    expect(editor, 'the grant editor').toBeDefined();
    const note = editor!.children![1] as Node;
    expect(note.type).toBe('we-text');
    expect(note.props).toMatchObject({ variant: 'footnote', color: 'text-muted' });
    expect(note.children).toEqual([
      "This app, and any other app you've allowed to manage your identity, can change these permissions or resume the bot without asking you.",
    ]);
  });
});
