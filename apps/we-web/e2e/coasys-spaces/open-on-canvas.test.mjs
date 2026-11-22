/**
 * The card `openOnCanvas` presses, on the canvas job 85044 left behind.
 *
 * The real model named a Question "Should we rebuild the sync script?" and a Task "Rebuild the sync
 * script". `getByText` without `exact` is a substring match, so the first hit was the Question's
 * title. Its inspector offers Decide. Build runs on a Task, and the menu had no Build item.
 *
 * A second card carries the same title and is not that Task: a suggested TaskBlock (status, priority,
 * due date, assignee), which Build does not run on. The card the step wants is the Task the agent
 * took, the one that shows the owner's name.
 *
 * The stub's Question is "Should we rebuild sync?", which does not contain the task title, so the
 * same step passes there.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chromePath } from '@we/e2e/env';

import { openOnCanvas } from './canvas.mjs';

/**
 * playwright-core belongs to `@we/e2e`, which launches the browser. This package does not depend on
 * it. Vite serves this file over http, so `import.meta.url` is not a file URL createRequire accepts.
 */
function thisFile() {
  const url = import.meta.url;
  const served = url.indexOf('/@fs/');
  if (served >= 0) return url.slice(served + '/@fs'.length).split('?')[0];
  return fileURLToPath(url);
}
const require = createRequire(join(dirname(thisFile()), '../../../../packages/e2e/package.json'));
const { chromium } = require('playwright-core');

const TASK = 'Rebuild the sync script';
const OWNER = 'Coasys agent';

/** One canvas card, in the shape the graph draws: the title is its own element, the kind is another. */
function card({ kind, id, title, lines = [], suggested = false }) {
  const body = [
    suggested ? '<div>suggested</div>' : '',
    `<div>${kind}</div>`,
    `<div style="font-weight: 600">${title}</div>`,
    ...lines.map((line) => `<div>${line}</div>`),
  ].join('');
  return `<div class="we-graph__node we-graph__node--card" title="${title}" data-kind="${kind}" data-id="${id}">${body}</div>`;
}

function pageHtml(cards) {
  return `<!doctype html><button>Canvas</button><div class="we-graph"><div class="we-graph__nodes">${cards.join('')}</div></div>`;
}

/** Job 85044's canvas, in the order the trace's DOM held the cards. */
function job85044({ taskFirst = true } = {}) {
  const question = card({
    kind: 'Question',
    id: 'question',
    title: 'Should we rebuild the sync script?',
    lines: ['Status open'],
    suggested: true,
  });
  const taken = card({ kind: 'Task', id: 'task-taken', title: TASK, lines: [OWNER] });
  const other = card({
    kind: 'TaskBlock',
    id: 'task-block',
    title: TASK,
    lines: ['Status To do', 'Priority medium', 'Due date Nov 27, 2026', 'Assignee Alice'],
    suggested: true,
  });
  const tasks = taskFirst ? [taken, other] : [other, taken];
  return pageHtml([
    card({ kind: 'Decision', id: 'decision', title: 'Mobile comes first', suggested: true }),
    card({
      kind: 'Tension',
      id: 'tension',
      title: 'rebuilding the sync script vs the v2.4 release',
      suggested: true,
    }),
    question,
    ...tasks,
  ]);
}

/** The stub's titles: the question does not contain the task title. */
function stubTitles() {
  return pageHtml([
    card({ kind: 'Question', id: 'question', title: 'Should we rebuild sync?', lines: ['Status open'] }),
    card({ kind: 'Task', id: 'task-taken', title: TASK, lines: [OWNER] }),
  ]);
}

describe('openOnCanvas on the real tier’s canvas', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chromePath(), headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function opened(html) {
    await page.setContent(html);
    // After setContent: an init script does not survive the document it replaces.
    await page.evaluate(() => {
      document.addEventListener(
        'click',
        (event) => {
          const node = event.target instanceof Element ? event.target.closest('.we-graph__node') : null;
          document.documentElement.dataset.opened = node ? `${node.dataset.kind}|${node.dataset.id}` : 'miss';
        },
        true,
      );
    });
    await openOnCanvas(page, TASK, { carrying: OWNER });
    return page.evaluate(() => document.documentElement.dataset.opened ?? 'none');
  }

  it('opens the Task the agent took, not the Question whose title contains it (job 85044)', async () => {
    expect(await opened(job85044())).toBe('Task|task-taken');
  });

  it('opens that Task when the other card with the same title is listed first', async () => {
    expect(await opened(job85044({ taskFirst: false }))).toBe('Task|task-taken');
  });

  it('still opens the stub tier’s Task, whose question does not contain the title', async () => {
    expect(await opened(stubTitles())).toBe('Task|task-taken');
  });

  it('says which cards are on the canvas when none is the one asked for', async () => {
    await page.setContent(job85044());
    await expect(openOnCanvas(page, 'No such task', { timeout: 300 })).rejects.toThrow(
      /No canvas card titled exactly "No such task"\. The canvas has: Mobile comes first \| rebuilding the sync script vs the v2\.4 release \| Should we rebuild the sync script\? \| Rebuild the sync script \| Rebuild the sync script/,
    );
  });
});
