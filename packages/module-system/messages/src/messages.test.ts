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
});

describe('how a line arrived', () => {
  it('turns a heard line corrected when somebody edits it, and leaves anything else as it was', () => {
    expect(sourceAfterEdit(SPOKEN)).toBe(CORRECTED);
    expect(sourceAfterEdit(TYPED)).toBeUndefined();
    expect(sourceAfterEdit(CORRECTED)).toBeUndefined();
  });
});
