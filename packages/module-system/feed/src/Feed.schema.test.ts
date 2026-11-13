/**
 * The Feed as drawn: the transcript's line, its own reply, and two placements of one stream.
 */
import type { SchemaNode } from '@we/schema-shared';
import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { feedPanel, feedView } from './Feed.schema';
import { feedModule } from './index';

const panel = JSON.stringify(feedPanel);
const view = JSON.stringify(feedView);

/** The first node under `root`, depth first, that `match` accepts. */
function findNode(root: unknown, match: (node: SchemaNode) => boolean): SchemaNode | undefined {
  if (!root || typeof root !== 'object') return undefined;
  if (Array.isArray(root)) {
    for (const child of root) {
      const found = findNode(child, match);
      if (found) return found;
    }
    return undefined;
  }
  if (match(root as SchemaNode)) return root as SchemaNode;
  for (const value of Object.values(root)) {
    const found = findNode(value, match);
    if (found) return found;
  }
  return undefined;
}

/** Every node under `root` that `match` accepts, depth first. */
function findAll(root: unknown, match: (node: SchemaNode) => boolean): SchemaNode[] {
  const found: SchemaNode[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (match(node as SchemaNode)) found.push(node as SchemaNode);
    Object.values(node).forEach(walk);
  };
  walk(root);
  return found;
}

/** The rows the `$each` draws, evaluated as the renderer would — a stubbed store in, ids out. */
function feedRowIds(options: { showCallTranscripts: boolean; feedShow?: string; feedRows?: unknown[] }): string[] {
  const each = findNode(
    feedPanel,
    (n) => n.type === '$each' && (n.props as { as?: unknown } | undefined)?.as === 'row',
  )!;
  const source = (each.props as { items: { $: string } }).items.$;
  const roots: Record<string, unknown> = {
    modules: {
      feed: {
        feedRows: options.feedRows ?? [],
        showCallTranscripts: options.showCallTranscripts,
        feedFromStart: false,
        timelineOrientation: 'newestBottom',
        botAuthors: ['did:bot'],
      },
    },
    local: { feedShow: options.feedShow ?? 'all' },
  };
  const rows = evaluateExpression(parseExpression(source), {
    root: (name) => ({ bound: name in roots, value: roots[name] }),
    call: (name, args) =>
      listFunctions()
        .find((f) => f.name === name)
        ?.impl(args, { context: {}, stores: {} }),
  });
  return (rows as { id: string }[]).map((row) => row.id).sort();
}

const FEED_ROWS = [
  { kind: 'line', id: 'spoken-1', source: 'spoken', author: 'did:ann', text: 'said in the call' },
  { kind: 'line', id: 'typed-1', source: 'typed', author: 'did:ann', text: 'typed into the space' },
  { kind: 'line', id: 'bot-1', source: '', author: 'did:bot', text: 'a bot answering' },
  { kind: 'activity', id: 'act-1', author: 'did:ann', summary: '2 tasks' },
];

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

describe('call transcripts in the Feed', () => {
  /*
    Every line a call hears is written into the space, so the Feed of a space that calls often is
    mostly a transcript and its own messages sink. The reader's choice is per space — a standup they
    skim is not the all-hands they want verbatim — which is the `agent-in-space` level rather than
    the agent's everywhere. Off is the default: the transcript is where a call's words are read.
  */
  it('declares a per-space, default-off setting for them', () => {
    const setting = (feedModule.contributes?.settings ?? []).find((s) => s.key === 'showCallTranscripts');
    expect(setting).toMatchObject({ type: 'boolean', default: false, levels: ['agent-in-space'] });
  });

  it('hides the lines a call spoke until this reader asks for them, in this space', () => {
    expect(feedRowIds({ showCallTranscripts: false, feedRows: FEED_ROWS })).toEqual(['act-1', 'bot-1', 'typed-1']);
    expect(feedRowIds({ showCallTranscripts: true, feedRows: FEED_ROWS })).toEqual([
      'act-1',
      'bot-1',
      'spoken-1',
      'typed-1',
    ]);
  });

  it('hides nothing else — written messages, bots’ lines and what was found stay', () => {
    // A line heard but corrected is no longer verbatim speech; a reply with no source is a bot's.
    const rows = [
      { kind: 'line', id: 'mended', source: 'corrected', author: 'did:ann' },
      { kind: 'line', id: 'call-item', source: '', author: 'did:system', text: 'call started' },
    ];
    expect(feedRowIds({ showCallTranscripts: false, feedRows: rows })).toEqual(['call-item', 'mended']);
    // Messages is every line — a bot's among them; only the spoken one goes.
    expect(feedRowIds({ showCallTranscripts: false, feedShow: 'messages', feedRows: FEED_ROWS })).toEqual([
      'bot-1',
      'typed-1',
    ]);
    expect(feedRowIds({ showCallTranscripts: false, feedShow: 'bots', feedRows: FEED_ROWS })).toEqual(['bot-1']);
  });

  it('offers the choice as a switch in the header, written where other feed settings are kept', () => {
    const switches = findAll(feedPanel, (n) => n.type === 'we-switch');
    const chosen = switches.find((n) => JSON.stringify(n).includes('showCallTranscripts'));
    expect(chosen, 'no transcripts switch in the feed header').toBeDefined();
    const props = chosen!.props as {
      label?: unknown;
      checked?: unknown;
      onChange?: { $invoke?: string; args?: unknown[] };
    };
    expect(props.label).toBe('Show call transcripts');
    expect(props.checked).toEqual({ $: 'modules.feed.showCallTranscripts' });
    expect(props.onChange).toMatchObject({
      $invoke: 'spaceStore.setMyModuleSetting',
      args: ['feed', 'showCallTranscripts', { $: 'event.detail' }],
    });
    for (const json of [panel, view]) expect(json).toContain('Show call transcripts');
  });
});
