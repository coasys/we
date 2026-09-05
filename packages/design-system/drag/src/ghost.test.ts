/**
 * Who draws the thing under the pointer.
 *
 * This package deliberately knows nothing about what a record looks like — it has no dependency on
 * the design system, and must keep none, since the sortable and the block editor drive it from
 * inside that system. So a `node` ghost asks the host, and the interesting cases are all about what
 * happens when the host is absent, declines, or is torn down.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGhost, setGhostRenderer } from './ghost';
import type { DragItem } from './types';

const item = (label = 'A post'): DragItem => ({ ref: { entity: 'CollectionBlock', id: 'id-1' }, label });

afterEach(() => {
  setGhostRenderer(null);
  document.body.innerHTML = '';
});

describe('a node ghost', () => {
  it('is drawn by whatever the host registered', () => {
    setGhostRenderer(() => {
      const el = document.createElement('div');
      el.className = 'record-card';
      return el;
    });

    const ghost = createGhost({ kind: 'node', items: [item()] });

    expect(ghost.el.className).toBe('record-card');
    expect(ghost.el.isConnected).toBe(true);
    ghost.destroy();
  });

  it('is handed every item, so a host can say how many are in flight', () => {
    const seen: DragItem[][] = [];
    setGhostRenderer((items) => {
      seen.push(items);
      return document.createElement('div');
    });

    createGhost({ kind: 'node', items: [item('One'), item('Two')] }).destroy();

    expect(seen[0].map((i) => i.label)).toEqual(['One', 'Two']);
  });

  it('falls back to a chip when no host has registered one', () => {
    // The reason `node` can be the session's default: a consumer with no host gets exactly what it
    // got before, and does not have to know which it is getting.
    const ghost = createGhost({ kind: 'node', items: [item('A post')] });

    expect(ghost.el.hasAttribute('data-we-drag-ghost')).toBe(true);
    expect(ghost.el.textContent).toContain('A post');
    ghost.destroy();
  });

  it('falls back to a chip when the host declines this payload', () => {
    setGhostRenderer(() => null);
    const ghost = createGhost({ kind: 'node', items: [item('A post')] });

    expect(ghost.el.textContent).toContain('A post');
    ghost.destroy();
  });

  it('is positioned and made un-pointable by the session, not by the host', () => {
    // A host that forgot `pointer-events: none` would otherwise have its own card intercept the
    // drop — the ghost is under the pointer for the whole gesture.
    setGhostRenderer(() => document.createElement('div'));
    const ghost = createGhost({ kind: 'node', items: [item()] });

    expect(ghost.el.style.position).toBe('fixed');
    expect(ghost.el.style.pointerEvents).toBe('none');
    ghost.destroy();
  });

  it('tears the host renderer down on destroy', () => {
    // A rendered card owns a framework root. Without this every drag would leak one, and a leaked
    // Solid root keeps its subscriptions — so a ghost would go on reacting to store changes after
    // the drag that made it had ended.
    const dispose = vi.fn();
    setGhostRenderer(() => {
      const el = document.createElement('div') as HTMLElement & { _weDispose?: () => void };
      el._weDispose = dispose;
      return el;
    });

    const ghost = createGhost({ kind: 'node', items: [item()] });
    ghost.destroy();
    ghost.destroy();

    // Once, not twice: `drop` and `end` both run on a completed drag.
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-we-drag-ghost]')).toBeNull();
  });
});

describe('registering', () => {
  it('replaces the previous renderer, since there is one drag session per window', () => {
    setGhostRenderer(() => Object.assign(document.createElement('div'), { className: 'first' }));
    setGhostRenderer(() => Object.assign(document.createElement('div'), { className: 'second' }));

    const ghost = createGhost({ kind: 'node', items: [item()] });
    expect(ghost.el.className).toBe('second');
    ghost.destroy();
  });

  it('unregisters only itself, so a late teardown cannot unhook a newer renderer', () => {
    const off = setGhostRenderer(() => Object.assign(document.createElement('div'), { className: 'first' }));
    setGhostRenderer(() => Object.assign(document.createElement('div'), { className: 'second' }));
    off();

    const ghost = createGhost({ kind: 'node', items: [item()] });
    expect(ghost.el.className).toBe('second');
    ghost.destroy();
  });
});
