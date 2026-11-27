/**
 * Where a drag of a canvas card has to start, and that it does start.
 *
 * Nightly coasys-spaces #91692 (2026-11-25): the card for "Should we rebuild the sync?" sat in the
 * bottom row of the tray, and the floating call stage covered its centre. The step pressed the
 * centre, the press landed on the stage, and no Placement was written.
 *
 * `pointOnCard` returns a point where `elementFromPoint` is `.we-graph__surface` inside the card's
 * box — the centre when it is free, otherwise the upper third or the top-left. A descendant of the
 * card is not that point: the graph listens on the surface, and a descendant that takes the pointer
 * stops the press. `parkCallStage` moves the stage once, by its grip, before that probe.
 *
 * The page is the graph's hit model in miniature. The node layer sets `pointer-events: none`, and
 * that inherits, so a press on a card hits the surface. The surface listener moves the node, which
 * is how a case shows that a drag started.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { launchBrowser } from '@we/e2e/browser';

import { parkCallStage, pointOnCard } from './canvas.mjs';

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

/** One card whose centre is at (`x`, `y`). `hole` is a descendant that takes the pointer over the lower part. */
function cardAt(x, y, { hole = false } = {}) {
  const body = hole
    ? '<div class="hole" style="position:absolute;left:0;right:0;top:50px;bottom:0;pointer-events:auto"></div>'
    : '<div class="we-graph__card-content">Should we rebuild the sync?</div>';
  return `<div class="we-graph__node" style="transform: translate(${x}px, ${y}px)">
    <div class="we-graph__card">${body}</div>
  </div>`;
}

/** The call stage. The grip is the one `parkCallStage` drags, named the way the shell names it. */
function stage({ left, top, width, height }) {
  return `<div class="call-stage" data-we-dock-frame="call:stage" aria-label="Call"
    style="left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px">
    <we-move-handle data-we-panel-grip="call:stage" aria-label="Move panel" role="button">Move panel</we-move-handle>
    <div class="call-stage__tile" aria-label="You">You</div>
  </div>`;
}

/**
 * The stage follows its grip, and a press on the surface moves the card. Both listen with pointer
 * capture, because the thing being dragged leaves the cursor. A press that is not the surface
 * leaves the card where it is, which is the graph's own rule.
 */
async function show(page, html) {
  await page.setContent(html);
  await page.evaluate(() => {
    const panel = document.querySelector('[data-we-dock-frame="call:stage"]');
    const grip = panel?.querySelector('[data-we-panel-grip="call:stage"]');
    if (grip && panel) {
      let origin = null;
      let start = null;
      const release = (event) => {
        if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
        start = null;
      };
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
      grip.addEventListener('pointerup', release);
      grip.addEventListener('pointercancel', release);
    }
    const surface = document.querySelector('.we-graph__surface');
    const node = document.querySelector('.we-graph__node');
    if (surface && node) {
      let origin = null;
      let start = null;
      const release = (event) => {
        if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
        start = null;
      };
      surface.addEventListener('pointerdown', (event) => {
        if (event.target !== surface) return;
        start = { x: event.clientX, y: event.clientY };
        const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(node.style.transform);
        origin = { x: Number(match[1]), y: Number(match[2]) };
        surface.setPointerCapture(event.pointerId);
      });
      surface.addEventListener('pointermove', (event) => {
        if (!start) return;
        node.style.transform = `translate(${origin.x + event.clientX - start.x}px, ${origin.y + event.clientY - start.y}px)`;
      });
      surface.addEventListener('pointerup', release);
      surface.addEventListener('pointercancel', release);
    }
  });
}

function card(page) {
  return page.locator('.we-graph__card').first();
}

/** The node's centre, read from the transform the surface's drag writes. */
async function nodeAt(page) {
  return page.evaluate(() => {
    const node = document.querySelector('.we-graph__node');
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(node.style.transform);
    return { x: Number(match[1]), y: Number(match[2]) };
  });
}

/** The same gesture the V2 step makes after `pointOnCard`. Returns how far the node moved. */
async function dragFrom(page, point) {
  const before = await nodeAt(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 40, point.y - 100, { steps: 8 });
  await page.mouse.up();
  const after = await nodeAt(page);
  return { dx: after.x - before.x, dy: after.y - before.y };
}

describe('pointOnCard', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await launchBrowser();
  }, LAUNCH);

  // A new page each time. A drag that captured the pointer, then `setContent`, leaves the next
  // gesture on that same page unable to capture again — the panel would not follow its grip.
  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page?.close();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('drags the card from its centre when the surface is there', async () => {
    await show(page, graph(cardAt(400, 220)));
    const point = await pointOnCard(page, card(page), 'Should we rebuild the sync?');
    expect(point.name).toBe('centre');
    const moved = await dragFrom(page, point);
    expect(moved).toEqual({ dx: 40, dy: -100 });
  });

  it('does not press a descendant of the card, even one that takes the pointer', async () => {
    // The lower part of the card, including its centre, is a descendant with `pointer-events: auto`.
    // The upper third is still the surface. A press on the descendant would not start a drag.
    await show(page, graph(cardAt(400, 260, { hole: true })));
    const point = await pointOnCard(page, card(page), 'Should we rebuild the sync?');
    expect(point.name).toBe('upper third');
    const moved = await dragFrom(page, point);
    expect(moved).toEqual({ dx: 40, dy: -100 });
  });

  it('does not press the centre the call stage covers (nightly 91692)', async () => {
    // The card's centre sits under the stage. Its upper third does not.
    await show(page, graph(cardAt(400, 260), stage({ left: 250, top: 230, width: 320, height: 250 })));
    const point = await pointOnCard(page, card(page), 'Should we rebuild the sync?');
    expect(point.name).toBe('upper third');
    const moved = await dragFrom(page, point);
    expect(moved).toEqual({ dx: 40, dy: -100 });
  });

  it('names the element on the centre when every sample point is covered', async () => {
    await show(
      page,
      graph(
        cardAt(400, 300),
        `<div class="call-stage" aria-label="Call" style="inset: 0; width: 900px; height: 640px"></div>`,
      ),
    );
    await expect(pointOnCard(page, card(page), 'Should we rebuild the sync?')).rejects.toThrow(
      /"Should we rebuild the sync\?" is covered at its centre, its upper third and its top-left; the centre is under div\.call-stage\[aria-label="Call"\]/,
    );
  });

  it('moves the call stage by its grip to the bottom-right marker, then a drag of the card starts', async () => {
    await show(page, graph(cardAt(400, 300), stage({ left: 260, top: 200, width: 300, height: 240 })));
    // The marker the shell would draw. The helper aims at it; this page has no shell to draw one.
    await page.evaluate(() => {
      const marker = document.createElement('div');
      marker.id = 'landing';
      marker.style.cssText = [
        'position:fixed',
        `left:${window.innerWidth - 200}px`,
        `top:${window.innerHeight - 180}px`,
        'width:90px',
        'height:70px',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(marker);
    });
    const before = await page.locator('[data-we-dock-frame="call:stage"]').boundingBox();
    const grip = await page.locator('[data-we-panel-grip="call:stage"]').boundingBox();
    const marker = await page.locator('#landing').boundingBox();
    await parkCallStage(page);
    const after = await page.locator('[data-we-dock-frame="call:stage"]').boundingBox();
    const dx = marker.x + marker.width / 2 - (grip.x + grip.width / 2);
    const dy = marker.y + marker.height / 2 - (grip.y + grip.height / 2);
    expect(after.x).toBeCloseTo(before.x + dx, 0);
    expect(after.y).toBeCloseTo(before.y + dy, 0);
    const point = await pointOnCard(page, card(page), 'Should we rebuild the sync?');
    const moved = await dragFrom(page, point);
    expect(moved).toEqual({ dx: 40, dy: -100 });
  });
});
