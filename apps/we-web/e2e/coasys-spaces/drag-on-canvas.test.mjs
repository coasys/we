/**
 * Where a drag of a canvas card has to start.
 *
 * Nightly coasys-spaces #91692 (2026-11-25): the card for "Should we rebuild the sync?" sat in the
 * bottom row of the tray, and the floating call stage covered its centre. The step pressed the
 * centre, the press landed on the stage, and no Placement was written. `pointOnCard` presses a
 * point `elementFromPoint` says is the card — the centre when it is free, otherwise the upper
 * third or the top-left — and, when the stage covers all three, moves the stage or pans once.
 *
 * The page is the graph's hit model in miniature. The node layer sets `pointer-events: none`, and
 * that inherits, so a card does not take the pointer: a press on it hits `.we-graph__surface`, and
 * the graph picks the card from the point. A descendant that sets `pointer-events: auto` — text in
 * an open shadow root — is the card by walking out through the host. A stage above the card is
 * neither, so it is not a place to press.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchBrowser } from '@we/e2e/browser';

import { pointOnCard } from './canvas.mjs';

/** Chrome's first launch on a CI runner can take longer than vitest's 10 s hook default. */
const LAUNCH = 60_000;

const CSS = `
  html, body { margin: 0; }
  .we-graph { position: relative; width: 900px; height: 640px; }
  .we-graph__surface { position: absolute; inset: 0; }
  .we-graph__nodes { position: absolute; inset: 0; pointer-events: none; }
  .we-graph__node { position: absolute; top: 0; left: 0; width: 0; height: 0; pointer-events: none; }
  .we-graph__card {
    position: absolute; left: 0; top: 0; transform: translate(-50%, -50%);
    width: 220px; height: 140px; background: #243044;
  }
  .we-graph__card-content { width: 100%; height: 100%; pointer-events: none; }
  .call-stage {
    position: absolute; z-index: 5; background: #111827; color: white;
  }
  we-move-handle { display: block; height: 28px; }
`;

function graph(cards, overlay = '') {
  return `<!doctype html>
<style>${CSS}</style>
<div class="we-graph">
  <div class="we-graph__surface"></div>
  <div class="we-graph__nodes">${cards}</div>
</div>
${overlay}`;
}

/** One card whose centre is at (`x`, `y`). `shadow` puts the title in an open shadow root. */
function cardAt(x, y, { shadow = false, inert = false } = {}) {
  const body = shadow
    ? '<div class="host" style="width:100%;height:100%"></div>'
    : '<div class="we-graph__card-content">Should we rebuild the sync?</div>';
  const events = inert ? ' style="pointer-events: none"' : '';
  return `<div class="we-graph__node" style="transform: translate(${x}px, ${y}px)">
    <div class="we-graph__card"${events}>${body}</div>
  </div>`;
}

/** The call stage, as a dock frame with the grip a person drags it by. */
function stage({ left, top, width, height, grip = true }) {
  const handle = grip ? '<we-move-handle aria-label="Move panel" role="button">Move panel</we-move-handle>' : '';
  return `<div class="call-stage" data-we-dock-frame aria-label="Call"
    style="left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px">${handle}
    <div class="call-stage__tile" aria-label="You">You</div>
  </div>`;
}

/**
 * The stage follows its grip, and a pan of the surface moves the card, the way the shell and the
 * graph do. Both listen with pointer capture, because the thing being dragged leaves the cursor.
 */
async function show(page, html, { shadow = false } = {}) {
  await page.setContent(html);
  if (shadow) {
    await page.evaluate(() => {
      const host = document.querySelector('.host');
      const root = host.attachShadow({ mode: 'open' });
      // `auto` is what makes this the hit. The card inherits `none` from the node layer, and a
      // shadow tree does too, unless something in it turns the pointer back on.
      root.innerHTML = '<div style="width:100%;height:100%;pointer-events:auto">Should we rebuild the sync?</div>';
    });
  }
  await page.evaluate(() => {
    const panel = document.querySelector('[data-we-dock-frame]');
    const grip = panel?.querySelector('we-move-handle');
    if (grip && panel) {
      let origin = null;
      let start = null;
      grip.addEventListener('pointerdown', (event) => {
        start = { x: event.clientX, y: event.clientY };
        origin = { left: panel.offsetLeft, top: panel.offsetTop };
        grip.setPointerCapture(event.pointerId);
      });
      grip.addEventListener('pointermove', (event) => {
        if (!start) return;
        panel.style.left = `${origin.left + event.clientX - start.x}px`;
        panel.style.top = `${origin.top + event.clientY - start.y}px`;
      });
      grip.addEventListener('pointerup', () => {
        start = null;
      });
    }
    const surface = document.querySelector('.we-graph__surface');
    const node = document.querySelector('.we-graph__node');
    if (surface && node) {
      let origin = null;
      let start = null;
      surface.addEventListener('pointerdown', (event) => {
        if (event.target !== surface) return;
        start = { x: event.clientX, y: event.clientY };
        const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(node.style.transform);
        origin = { x: Number(match[1]), y: Number(match[2]) };
        surface.setPointerCapture(event.pointerId);
      });
      surface.addEventListener('pointermove', (event) => {
        if (!start) return;
        const x = origin.x + event.clientX - start.x;
        const y = origin.y + event.clientY - start.y;
        node.style.transform = `translate(${x}px, ${y}px)`;
      });
      surface.addEventListener('pointerup', () => {
        start = null;
      });
    }
  });
}

/** What `elementFromPoint` names at the card's centre — the press the old step made. */
async function centreHit(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.we-graph__card');
    const box = card.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return `${hit?.className || hit?.tagName || 'nothing'}`;
  });
}

/**
 * Whether a press at `point` starts a drag of the card: the hit is the card (or a shadow descendant
 * of it) or the canvas surface, and the point lies in the card's box.
 */
async function pressesCard(page, point) {
  return page.evaluate(({ x, y }) => {
    const card = document.querySelector('.we-graph__card');
    const box = card.getBoundingClientRect();
    const hit = document.elementFromPoint(x, y);
    const inside = x >= box.left && x < box.right && y >= box.top && y < box.bottom;
    const surface = hit?.classList?.contains('we-graph__surface') ?? false;
    let node = hit;
    let owned = false;
    while (node) {
      if (node === card) {
        owned = true;
        break;
      }
      const root = node.getRootNode?.();
      node = node.parentElement || (root instanceof ShadowRoot ? root.host : null);
    }
    return {
      name: `${hit?.className || hit?.tagName || 'nothing'}`,
      inside,
      owned,
      surface,
      ok: inside && (owned || surface),
    };
  }, point);
}

describe('pointOnCard', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await launchBrowser();
    page = await browser.newPage();
  }, LAUNCH);

  afterAll(async () => {
    await browser?.close();
  });

  const card = () => page.locator('.we-graph__card').first();

  it('presses the centre when the card owns it, including text in an open shadow root', async () => {
    await show(page, graph(cardAt(400, 220, { shadow: true })), { shadow: true });
    const point = await pointOnCard(page, card(), 'Should we rebuild the sync?');
    expect(point.name).toBe('centre');
    const owned = await page.evaluate(() => {
      const el = document.querySelector('.we-graph__card');
      const box = el.getBoundingClientRect();
      let node = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      while (node) {
        if (node === el) return true;
        node = node.parentElement || (node.parentNode instanceof ShadowRoot ? node.parentNode.host : null);
      }
      return false;
    });
    expect(owned).toBe(true);
  });

  it('presses the centre when the card takes no pointer and the canvas surface does', async () => {
    await show(page, graph(cardAt(400, 220, { inert: true })));
    const point = await pointOnCard(page, card(), 'Should we rebuild the sync?');
    expect(point.name).toBe('centre');
    expect(await centreHit(page)).toBe('we-graph__surface');
  });

  it('does not press the centre the call stage covers (nightly 91692)', async () => {
    // The card's centre sits under the stage's body, below its grip. Its upper third does not.
    // The card takes no pointer, so the free point is the surface in the card's box.
    await show(page, graph(cardAt(400, 260), stage({ left: 250, top: 220, width: 320, height: 250 })));
    expect(await centreHit(page)).toContain('call-stage');
    const point = await pointOnCard(page, card(), 'Should we rebuild the sync?');
    expect(point.name).toBe('upper third');
    expect(await pressesCard(page, point)).toMatchObject({ ok: true, surface: true });
  });

  it('moves the stage when it covers the centre, the upper third and the top-left', async () => {
    await show(page, graph(cardAt(400, 300), stage({ left: 260, top: 200, width: 300, height: 240 })));
    expect(await centreHit(page)).toContain('call-stage');
    const point = await pointOnCard(page, card(), 'Should we rebuild the sync?');
    expect(await pressesCard(page, point)).toMatchObject({ ok: true });
    expect(await centreHit(page)).toBe('we-graph__surface');
  });

  it('pans the canvas when what covers the card cannot be dragged', async () => {
    await show(page, graph(cardAt(180, 420), stage({ left: 60, top: 340, width: 280, height: 200, grip: false })));
    expect(await centreHit(page)).toContain('call-stage');
    const point = await pointOnCard(page, card(), 'Should we rebuild the sync?');
    expect(await pressesCard(page, point)).toMatchObject({ ok: true });
    expect(await centreHit(page)).toBe('we-graph__surface');
  });

  it('names the element on the centre when the card stays covered', async () => {
    await show(
      page,
      graph(
        cardAt(400, 300),
        `<div class="call-stage" aria-label="Call" style="inset: 0; width: 900px; height: 640px"></div>`,
      ),
    );
    await expect(pointOnCard(page, card(), 'Should we rebuild the sync?')).rejects.toThrow(
      /"Should we rebuild the sync\?" is covered at its centre, its upper third and its top-left; the centre is under div\.call-stage\[aria-label="Call"\]/,
    );
  });
});
