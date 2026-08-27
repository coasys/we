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

/** The nodes from the root down to `target`, so a test can ask what a node is gated by. */
function lineage(node: unknown, target: SchemaNode, trail: SchemaNode[] = []): SchemaNode[] | undefined {
  if (node === target) return trail;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = lineage(item, target, trail);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  const record = node as Record<string, unknown>;
  const next = typeof record.type === 'string' ? [...trail, record as unknown as SchemaNode] : trail;
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const found = lineage(value, target, next);
      if (found) return found;
    }
  }
  return undefined;
}

const props = (node: SchemaNode | undefined): Record<string, unknown> => (node?.props ?? {}) as Record<string, unknown>;

describe('the bar keeps to the screen', () => {
  it('centres inside a strip spanning the content, rather than positioning itself', () => {
    // A box centred by `translateX(-50%)` overhangs both sides equally once the content is narrower
    // than it, and the half over the sidebar leaves the window — hang-up button first. A strip
    // pinned at the content's edges, with `safe center`, is the same centring with a clamp.
    const strips = walk(slotNodes()).filter((node) => props(node).position === 'fixed');
    expect(strips.length).toBeGreaterThan(0);

    for (const strip of strips) {
      expect(props(strip).transform).toBeUndefined();
      expect(props(strip).left).toContain('--we-chrome-left');
      expect(props(strip).right).toContain('--we-chrome-right');

      const surface = walk(strip).find((node) => node.type === '$surface');
      const styles = props(surface).styles as Record<string, string> | undefined;
      expect(styles?.['justify-content']).toBe('safe center');
      // Which end the bar pins to when it cannot fit is the host's to say — see `--we-chrome-give`.
      expect(styles?.['flex-direction']).toContain('--we-chrome-give');
    }
  });

  it('lets clicks through the strip and back on at the bar', () => {
    // The strip spans the whole edge. Left opaque to the pointer it would swallow every click along
    // the bottom of the content, so it passes them through and each child switches them back on.
    const strips = walk(slotNodes()).filter((node) => props(node).position === 'fixed');
    for (const strip of strips) {
      expect(props(strip).pointerEvents).toBe('none');
      const surface = walk(strip).find((node) => node.type === '$surface');
      const child = (surface?.children as SchemaNode[])[0];
      expect(props(child).pointerEvents).toBe('auto');
    }
  });
});

describe('the compact bar', () => {
  const COMPACT = { $eq: ['$surface.tier', 'base'] };
  const inCall = (): SchemaNode => walk(slotNodes()).find((node) => node.type === 'we-popover') as SchemaNode;

  /** The `$if` gates above `target` that read the strip's tier, innermost last. */
  const tierGates = (target: SchemaNode): SchemaNode[] =>
    (lineage(slotNodes(), target) ?? []).filter(
      (node) => node.type === '$if' && JSON.stringify(props(node).condition).includes('$surface.tier'),
    );

  const buttonFor = (action: string): SchemaNode =>
    walk(slotNodes()).find(
      (node) =>
        node.type === 'we-button' && JSON.stringify(props(node).onClick) === JSON.stringify({ $action: action }),
    ) as SchemaNode;

  it('folds screen share, show/hide and solo into one menu below the base tier', () => {
    const menu = inCall();
    expect(menu).toBeDefined();
    const gates = tierGates(menu);
    expect(gates.map((gate) => props(gate).condition)).toEqual([COMPACT]);

    const actions = walk(menu)
      .filter((node) => node.type === 'we-menu-item')
      .map((item) => (props(item).onSelect as { $action: string }).$action)
      .sort();
    expect(actions).toEqual(['modules.call.toggleScreenShare', 'modules.call.toggleSolo', 'modules.call.toggleStage']);
  });

  it('takes the same three out of the row at that tier, so nothing is shown twice', () => {
    for (const action of ['modules.call.toggleScreenShare', 'modules.call.toggleStage', 'modules.call.toggleSolo']) {
      const button = buttonFor(action);
      expect(button, action).toBeDefined();
      expect(
        tierGates(button).map((gate) => props(gate).condition),
        `${action} is not withdrawn from the row when the menu holds it`,
      ).toEqual([{ $not: COMPACT }]);
    }
  });

  it('never folds mute, camera or hang-up', () => {
    // They are the call. A menu between a person and their microphone is one step too many at the
    // moment they need it.
    for (const action of ['modules.call.toggleAudio', 'modules.call.toggleVideo', 'modules.call.leave']) {
      expect(tierGates(buttonFor(action)), action).toEqual([]);
    }
  });

  it('keeps contributed controls in the row at every width', () => {
    // This module cannot fold chrome it does not know the meaning of, and a contributed square may be
    // the loudest thing in the bar precisely because it has to be seen.
    const slot = walk(slotNodes()).find(
      (node) => node.type === '$slot' && props(node).anchor === 'call-controls',
    ) as SchemaNode;
    expect(slot).toBeDefined();
    expect(tierGates(slot)).toEqual([]);
  });
});
