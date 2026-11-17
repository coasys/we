/**
 * A call's messages, as a schema: what it reads, where it writes, and how a placement points it at
 * another call.
 *
 * The failures here are silent ones. A subject mentioned inside a longer expression is not rewritten
 * by a `$part` placement, so the page would read one call and write into another; a filter that lets
 * spoken lines through turns the pane into a second transcript; a panel key the store does not
 * publish leaves a button that opens nothing.
 */
import { markAction, markState } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { CALL_CONTROLS_ANCHOR } from './CallControl.schema';
import { transcribeModule } from './index';
import { callMessages, MESSAGES_SHOWN, MESSAGES_SUBJECT_EXPR, messagesControl, messagesPanel } from './Messages.schema';
import { createTranscribeStore } from './store';

type Node = { type?: string; props?: Record<string, unknown>; $queries?: Record<string, Record<string, unknown>> };

function findAll(root: unknown, match: (node: Node) => boolean): Node[] {
  const found: Node[] = [];
  (function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (match(node as Node)) found.push(node as Node);
    Object.values(node).forEach(walk);
  })(root);
  return found;
}

function storeKeys(): string[] {
  const store = createTranscribeStore({
    signal: <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => (value = next)];
    },
    state: markState,
    action: markAction,
    kernels: {},
  });
  return Object.keys(store);
}

describe('the call messages part', () => {
  it('is published under the subject token that is actually in its tree', () => {
    const part = transcribeModule.contributes?.parts?.callMessages;
    expect(part).toBeDefined();
    expect(typeof part === 'object' && 'subject' in part ? part.subject : undefined).toBe(MESSAGES_SUBJECT_EXPR);
  });

  it('names its subject only as a whole token, so a placement points every use at its call', () => {
    // Every mention, bare: the query's scope, its `when`, the gate and the message's target.
    const json = JSON.stringify(callMessages);
    const mentions = json.split(MESSAGES_SUBJECT_EXPR).length - 1;
    const bare = json.split(JSON.stringify({ $: MESSAGES_SUBJECT_EXPR })).length - 1;
    expect(mentions).toBeGreaterThanOrEqual(4);
    expect(bare).toBe(mentions);
  });

  it('reads the call’s typed lines, with their replies, bounded and waiting for a subject', () => {
    const [list] = findAll(callMessages, (n) => !!n.$queries?.messages);
    const query = list.$queries!.messages;
    expect(query).toMatchObject({
      entity: 'TextBlock',
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: MESSAGES_SUBJECT_EXPR } },
      where: { source: 'typed' },
      order: { createdAt: 'desc' },
      limit: MESSAGES_SHOWN,
      when: { $: MESSAGES_SUBJECT_EXPR },
      subscribe: true,
    });
    expect(query.include).toBeDefined();
  });

  it('draws each message with the line the Feed and the transcript share', () => {
    const json = JSON.stringify(callMessages);
    expect(json).toContain('threadLines({ rows: local.messages');
    // `messageLine` binds the author to `$agent`, and its Reply calls this module's `startReply`.
    expect(json).toContain('"did":{"$":"message.author"}');
    expect(json).toContain('modules.transcribe.startReply');
  });

  it('writes through the Feed’s composer, worded as messaging', () => {
    const [composer] = findAll(callMessages, (n) => n.type === 'BlockComposer');
    expect(composer.props).toMatchObject({ compact: true, placeholder: 'Message the call…' });
    const [send] = findAll(callMessages, (n) => n.type === 'we-tooltip' && n.props?.content === 'Send');
    expect(send).toBeDefined();
  });

  it('sends a message into the call, or a reply when one is being written', () => {
    const json = JSON.stringify(callMessages);
    expect(json).toContain(
      JSON.stringify({
        $invoke: 'modules.transcribe.addMessage',
        args: [{ $: MESSAGES_SUBJECT_EXPR }, { $: 'event.text' }, { $: 'event.marks' }],
        onFinally: [{ $setLocal: 'sending', value: false }],
      }),
    );
    expect(json).toContain('"$invoke":"modules.transcribe.reply"');
    // Guarded, so Enter twice during a slow write sends one message.
    expect(json).toContain('"condition":{"$":"!local.sending"}');
  });
});

describe('the Messages pane and its button', () => {
  it('is a panel the module opens and closes, with no rail button of its own', () => {
    const panel = transcribeModule.contributes?.panels?.find((p) => p.name === 'messages');
    expect(panel).toMatchObject({
      title: 'Messages',
      open: 'messagesOpen',
      show: 'openMessages',
      close: 'closeMessages',
    });
    expect(panel?.icon).toBeUndefined();
    expect(JSON.stringify(messagesPanel)).toContain('"id":"transcribe.callMessages"');

    const keys = storeKeys();
    for (const key of [panel!.open, panel!.show, panel!.close]) expect(keys, String(key)).toContain(key);
  });

  it('puts its button in the call’s bar, toggling the pane and counting what is unread', () => {
    const slot = transcribeModule.contributes?.slots?.find((s) => s.node === messagesControl);
    expect(slot?.anchor).toBe(CALL_CONTROLS_ANCHOR);

    const json = JSON.stringify(messagesControl);
    expect(json).toContain('"$invoke":"modules.transcribe.toggleMessages"');
    expect(json).toContain('"label":"Messages"');
    expect(json).toContain('modules.transcribe.unreadMessages > 0 && !modules.transcribe.messagesOpen');

    const keys = storeKeys();
    for (const key of ['toggleMessages', 'unreadMessages', 'messagesOpen']) expect(keys).toContain(key);
  });
});
