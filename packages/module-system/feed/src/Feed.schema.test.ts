/**
 * The Feed as drawn: the transcript's line, its own reply, and two placements of one stream.
 */
import { describe, expect, it } from 'vitest';

import { feedPanel, feedView } from './Feed.schema';
import { feedModule } from './index';

const panel = JSON.stringify(feedPanel);
const view = JSON.stringify(feedView);

describe('one line, the Feed’s own actions', () => {
  it("draws the transcript's line, Edit and the typed mark included", () => {
    expect(panel).toContain('"$invoke":"modules.feed.editUtterance"');
    expect(panel).toContain('"name":"keyboard"');
  });

  it('keeps its reply to itself, and asks nothing of transcription', () => {
    expect(panel).toContain('"$invoke":"modules.feed.startReply"');
    expect(panel).toContain(`"condition":{"$":"modules.feed.replyingTo"}`);
    expect(panel).not.toContain('modules.transcribe');
    expect(view).not.toContain('modules.transcribe');
  });
});

describe('two placements of one stream', () => {
  it('draws the same list and the same box as a panel and as a view', () => {
    for (const json of [panel, view]) {
      expect(json).toContain('"$invoke":"modules.feed.showMoreFeed"');
      expect(json).toContain('"$invoke":"modules.feed.sendToFeed"');
    }
  });

  it('is kept live while the view is drawn, as the panel is while it is open', () => {
    expect(feedModule.contributes?.parts?.feedView).toMatchObject({
      whileShown: { show: 'watchFeed', hide: 'unwatchFeed' },
    });
    expect(feedModule.contributes?.panels?.[0]).toMatchObject({
      open: 'feedOpen',
      show: 'openFeed',
      close: 'closeFeed',
    });
  });
});
