/**
 * The card `openOnCanvas` presses.
 *
 * The real model named a Question "Should we rebuild the sync script?" and a Task "Rebuild the sync
 * script". `getByText` without `exact` is a substring match, so the first hit was the Question's
 * title. Its inspector offers Decide. Build runs on a Task, and the menu had no Build item.
 *
 * A second card carries the same title and is not that Task: a suggested TaskBlock (status, priority,
 * due date, assignee), which Build does not run on. The card the step wants is the Task the agent
 * took. The two share a drawn kind — `modelLabel` drops a trailing "Block", so both headers read
 * "Task" — and the class is `data-type` on the node (`GraphView.solid.tsx`), which is `node.type`.
 *
 * The node itself is a zero-size anchor (`.we-graph__node` in `GraphView.scss`). The words are drawn
 * in `.we-graph__card` on it, in the shape `CANVAS_RECORD_CARD` (`canvasCard.ts`) renders: the kind in
 * the header, the title in its own element, each value on its own line. Playwright treats the anchor
 * as hidden, which is what the stub tier timed out on while the title attribute was already the title
 * it had been asked for.
 *
 * The stub's Question is "Should we rebuild sync?", which does not contain the task title. The stub
 * also writes a TaskBlock under the task's title (`roleOf` maps both classes to the task line).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchBrowser } from '@we/e2e/browser';

import { openOnCanvas } from './canvas.mjs';

/**
 * Chrome's first launch on a CI runner can take longer than vitest's 10 s hook default; it timed out
 * there before any case ran. The cases themselves wait a second at most.
 */
const LAUNCH = 60_000;

const TASK = 'Rebuild the sync script';
const OWNER = 'Coasys agent';
const QUICK = { timeout: 1_000 };

/**
 * `modelLabel` (`recordDisplay.ts`): a built-in `TaskBlock` is drawn "Task". A community class keeps
 * the name it was given.
 */
function kindLabel(type) {
  return type.endsWith('Block') && type !== 'Block' ? type.slice(0, -'Block'.length) : type;
}

/**
 * One canvas card, in the shape the graph draws.
 *
 * The node is the zero-size anchor `.we-graph__node` is in the stylesheet, and `data-type` is the
 * class. The card on it is `CANVAS_RECORD_CARD`: a header (the "suggested" badge, then the kind), the
 * title in its own element, then one line per value. The kind is the label, not the class, so a
 * TaskBlock's header says "Task".
 */
function card({ type, id, title, lines = [], prose = [], suggested = false, at = 0 }) {
  const header = [
    suggested ? '<span style="float: right">suggested</span>' : '',
    `<span style="opacity: 0.7">${kindLabel(type)}</span>`,
  ].join('');
  const body = lines
    .map(
      (line) =>
        `<div style="margin-top: 0.2em"><span style="opacity: 0.65; margin-inline-end: 0.35em">${line.label}</span><span>${line.text}</span></div>`,
    )
    .join('');
  const tail = prose
    .map((text) => `<div style="margin-top: 0.35em; white-space: pre-line"><span>${text}</span></div>`)
    .join('');
  // Apart, as a layout places them. Stacked on one anchor, the press would land on whichever card
  // was painted last, and the test could not see which one the helper asked for.
  const x = 280 + (at % 3) * 280;
  const y = 220 + Math.floor(at / 3) * 220;
  return `<div class="we-graph__node we-graph__node--card" data-type="${type}" data-id="${id}" title="${title}" style="transform: translate(${x}px, ${y}px); --node-width: 200px; --node-height: 140px">
    <div class="we-graph__card">
      <div class="we-graph__card-shape">
        <div class="we-graph__card-content">
          <div class="we-graph__card-scale">
            <div style="font-size: 0.8em">${header}</div>
            <div style="font-weight: 600">${title}</div>
            ${body}${tail}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function pageHtml(cards) {
  const drawn = cards.map((spec, at) => card({ ...spec, at })).join('');
  return `<!doctype html>
<style>
  /* The rules that decide whether Playwright calls a card visible. Copied from GraphView.scss:
     the node is a zero-size anchor; the card drawn on it is the box. The real cards are inert and
     the canvas surface hit-tests them; here the card takes the press, so the test can see which
     box was asked for. */
  .we-graph__node { position: absolute; top: 0; left: 0; width: 0; height: 0; pointer-events: none; }
  .we-graph__card {
    position: absolute; left: 0; top: 0; transform: translate(-50%, -50%);
    width: var(--node-width, 200px); height: var(--node-height, 140px);
    pointer-events: auto;
  }
</style>
<button>Canvas</button>
<div class="we-graph"><div class="we-graph__nodes">${drawn}</div></div>`;
}

/** Job 85044's canvas, in the order the trace's DOM held the cards. */
function job85044({ taskFirst = true } = {}) {
  const question = {
    type: 'Question',
    id: 'question',
    title: 'Should we rebuild the sync script?',
    lines: [{ label: 'Status', text: 'open' }],
    suggested: true,
  };
  const taken = { type: 'Task', id: 'task-taken', title: TASK, prose: [OWNER] };
  const other = {
    type: 'TaskBlock',
    id: 'task-block',
    title: TASK,
    lines: [
      { label: 'Status', text: 'To do' },
      { label: 'Priority', text: 'medium' },
      { label: 'Due date', text: 'Nov 27, 2026' },
      { label: 'Assignee', text: 'Alice' },
    ],
    suggested: true,
  };
  const tasks = taskFirst ? [taken, other] : [other, taken];
  return pageHtml([
    { type: 'Decision', id: 'decision', title: 'Mobile comes first', suggested: true },
    { type: 'Tension', id: 'tension', title: 'rebuilding the sync script vs the v2.4 release', suggested: true },
    question,
    ...tasks,
  ]);
}

/**
 * The stub tier's canvas, titles as the failing run listed them. The TaskBlock is first of the two
 * cards that share the task's title, which is what `.first()` would open.
 */
function stubCanvas() {
  return pageHtml([
    { type: 'Decision', id: 'decision', title: 'Mobile comes first this quarter', suggested: true },
    {
      type: 'Question',
      id: 'question',
      title: 'Should we rebuild sync?',
      lines: [{ label: 'Status', text: 'open' }],
    },
    {
      type: 'TaskBlock',
      id: 'task-block',
      title: TASK,
      lines: [
        { label: 'Status', text: 'To do' },
        { label: 'Priority', text: 'medium' },
      ],
      suggested: true,
    },
    { type: 'Task', id: 'task-taken', title: TASK, prose: [OWNER] },
    {
      type: 'Tension',
      id: 'tension',
      title: 'sync rebuild vs v2.4 release',
      prose: ['A rebuild could push back the v2.4 release.'],
      suggested: true,
    },
  ]);
}

describe('openOnCanvas on the canvas the graph draws', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await launchBrowser();
    page = await browser.newPage();
  }, LAUNCH);

  afterAll(async () => {
    await browser?.close();
  });

  async function opened(html, title, options) {
    await page.setContent(html);
    // After setContent: an init script does not survive the document it replaces.
    await page.evaluate(() => {
      document.addEventListener(
        'click',
        (event) => {
          const node = event.target instanceof Element ? event.target.closest('.we-graph__node') : null;
          document.documentElement.dataset.opened = node ? `${node.dataset.type}|${node.dataset.id}` : 'miss';
        },
        true,
      );
    });
    await openOnCanvas(page, title, { ...QUICK, ...options });
    return page.evaluate(() => document.documentElement.dataset.opened ?? 'none');
  }

  it('opens the Task the agent took, not the Question whose title contains it (job 85044)', async () => {
    expect(await opened(job85044(), TASK, { carrying: OWNER })).toBe('Task|task-taken');
  });

  it('opens that Task when the other card with the same title is listed first', async () => {
    expect(await opened(job85044({ taskFirst: false }), TASK, { type: 'Task', carrying: OWNER })).toBe(
      'Task|task-taken',
    );
  });

  it('opens the Task by its class when the TaskBlock is listed first and nothing else differs', async () => {
    expect(await opened(job85044({ taskFirst: false }), TASK, { type: 'Task' })).toBe('Task|task-taken');
  });

  it('opens the stub tier’s Question by its exact title and class (V4)', async () => {
    expect(await opened(stubCanvas(), 'Should we rebuild sync?', { type: 'Question' })).toBe('Question|question');
  });

  it('opens the stub tier’s Task, not the TaskBlock under the same title (V5)', async () => {
    expect(await opened(stubCanvas(), TASK, { type: 'Task', carrying: OWNER })).toBe('Task|task-taken');
  });

  it('says which cards are on the canvas when none is the one asked for', async () => {
    await page.setContent(job85044());
    await expect(openOnCanvas(page, 'No such task', QUICK)).rejects.toThrow(
      /No canvas card titled exactly "No such task"\. The canvas has: Mobile comes first \| rebuilding the sync script vs the v2\.4 release \| Should we rebuild the sync script\? \| Rebuild the sync script \| Rebuild the sync script/,
    );
  });
});
