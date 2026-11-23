import { describe, expect, it } from 'vitest';

import { CORRECTED, messageLine, sourceAfterEdit, SPOKEN, TYPED } from './index.ts';

describe('a message line', () => {
  it("calls the actions of whichever store drew it, so each list's replies stay its own", () => {
    const transcript = JSON.stringify(
      messageLine({ as: 'u', actions: 'modules.transcribe', surface: 'transcript', relative: true }),
    );
    const feed = JSON.stringify(messageLine({ as: 'row', actions: 'modules.feed', surface: 'feed', relative: false }));
    expect(transcript).toContain('"$invoke":"modules.transcribe.startReply"');
    expect(transcript).toContain('"$invoke":"modules.transcribe.editUtterance"');
    expect(feed).toContain('"$invoke":"modules.feed.startReply"');
    expect(feed).not.toContain('modules.transcribe');
  });

  it('dims a line that was sent and has not been read back', () => {
    const node = messageLine({ as: 'row', actions: 'modules.feed', surface: 'feed', relative: false });
    const column = (node.children as { props: Record<string, unknown> }[])[0];
    expect(column.props.opacity).toEqual({ $: 'row.sending ? 0.6 : 1' });
  });

  it('offers Reply and Edit only once the line has an id', () => {
    type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] };
    // The `$if` condition guarding the tooltip that carries `content`, found anywhere in the tree.
    const guardOf = (node: unknown, content: string): string | undefined => {
      if (Array.isArray(node)) return node.map((n) => guardOf(n, content)).find((g) => g !== undefined);
      if (node === null || typeof node !== 'object') return undefined;
      const n = node as Node;
      const then = n.props?.then as Node | undefined;
      if (n.type === '$if' && then?.type === 'we-tooltip' && then.props?.content === content) {
        return (n.props?.condition as { $: string }).$;
      }
      return guardOf(n.children, content) ?? guardOf(then, content);
    };
    const node = messageLine({ as: 'row', actions: 'modules.feed', surface: 'feed', relative: false });
    // A sending line has `id: ''`, which fails these; a line with an id passes them.
    expect(guardOf(node, 'Reply')).toBe("row.id != ''");
    expect(guardOf(node, 'Edit text')).toBe("!local.mending && row.id != ''");
  });
});

describe('how a line arrived', () => {
  it('turns a heard line corrected when somebody edits it, and leaves anything else as it was', () => {
    expect(sourceAfterEdit(SPOKEN)).toBe(CORRECTED);
    expect(sourceAfterEdit(TYPED)).toBeUndefined();
    expect(sourceAfterEdit(CORRECTED)).toBeUndefined();
  });
});
