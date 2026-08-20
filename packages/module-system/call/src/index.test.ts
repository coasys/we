/**
 * Where the call's sound comes from — an invariant no type can hold and nothing else asserts.
 *
 * A call's audio used to come out of the participant tiles' `<video>` elements, which are the most
 * conditional thing in the module: a tile renders one only while that peer has a picture, the stage
 * renders tiles only while it is open, and the host unmounts a dock nobody has open. So the sound
 * disappeared for three unrelated reasons, each of which looks correct in the file it lives in.
 *
 * These tests pin the arrangement that fixed it: the audio hangs off `active` and the pictures stay
 * silent. Structural rather than behavioural, because the failure is structural — every piece
 * rendered exactly as written, in the wrong dependency.
 */
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { callModule } from './index';

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

const slotNodes = (): SchemaNode[] => (callModule.slots ?? []).map((slot) => slot.node);

describe('audio', () => {
  it('plays from the chrome, which is mounted for the whole call', () => {
    // Not from the dock: `dockFrame` unmounts a panel with no edge, deliberately, so a stage nobody
    // is watching stops decoding video. Audio in there went with it.
    const sinks = walk(slotNodes()).filter((node) => node.type === 'we-audio');
    expect(sinks).toHaveLength(1);
    expect((sinks[0].props as Record<string, unknown>).autoplay).toBe(true);
  });

  it('depends on being in a call and on nothing else', () => {
    // Specifically not on `stageOpen`, `hasPicture`, or a placement — the three things that were
    // each, separately, able to silence a working call.
    const sinkSlot = slotNodes().find((node) => walk(node).some((child) => child.type === 'we-audio'));
    const condition = JSON.stringify((sinkSlot?.props as Record<string, unknown>)?.condition);

    expect(condition).toBe(JSON.stringify({ $store: 'modules.call.active' }));
  });

  it('leaves your own tile out of it', () => {
    // Your tile is your own microphone. Played back, it is a feedback loop — which is why the self
    // tile's video was the one that was always muted.
    const sink = walk(slotNodes()).find((node) => node.type === 'we-audio');
    const loop = walk(slotNodes()).find((node) => node.type === '$each' && walk(node).includes(sink as SchemaNode));

    expect(JSON.stringify((loop?.props as Record<string, unknown>)?.items)).toContain('"isSelf":false');
  });

  it('keeps every tile silent, so nobody is decoded twice', () => {
    // An unmuted tile beside the sink is the same voice from two decoders, slightly apart.
    const videos = walk(callModule.schemas?.tile).filter((node) => node.type === 'we-video');

    expect(videos).not.toHaveLength(0);
    for (const video of videos) expect((video.props as Record<string, unknown>).muted).toBe(true);
  });
});
