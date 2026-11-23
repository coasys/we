/**
 * Opening a record from the canvas. On its own, with no other import: the suite's unit test loads it
 * without a built workspace, and `steps.mjs` re-exports it for the verticals.
 *
 * The wait is the same length as `SLOW` in `context.mjs`. Repeated here so this file stays free of
 * that module, which pulls in the executor client.
 */
const SLOW = process.env.COASYS_SPACES_TIER === 'real' ? 600_000 : 120_000;

/** A value inside a CSS attribute selector. Class names are identifiers; quotes still have to be data. */
function cssAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Opens a record into the inspector by pressing its card on the canvas. Found inside the canvas's own
 * element: the Interpretation panel lists the same title, earlier in the page. The canvas names no role
 * or label, so its class is the one hold there is.
 *
 * The card is the node whose own title text is exactly `title`. A substring match opens a different
 * record whose title merely contains it. On the real tier a Question "Should we rebuild the sync
 * script?" was the first text containing the Task "Rebuild the sync script", and the inspector then
 * offered Decide, that Question's flow, rather than Build.
 *
 * The node is a zero-size anchor (`.we-graph__node` in `GraphView.scss`): Playwright treats it as
 * hidden, so waiting for the node never ends even when its title attribute is already the title.
 * The box that is visible, and the one the press lands on, is `.we-graph__card` drawn on that anchor.
 *
 * `type` is the record's class, `data-type` on the node (`node.type`). The words in the header are
 * the kind, and `modelLabel` draws both `Task` and `TaskBlock` as "Task", so the header cannot tell
 * them apart. `carrying` is text only the wanted card has, when two cards of one class share a title.
 * `timeout` is the wait for the card; the suite's own test passes a short one.
 */
export async function openOnCanvas(page, title, { carrying, type, timeout = SLOW } = {}) {
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  const typed = type ? `[data-type="${cssAttr(type)}"]` : '';
  let nodes = page.locator(`.we-graph__node.we-graph__node--card${typed}`).filter({
    has: page.getByText(title, { exact: true }),
  });
  if (carrying) nodes = nodes.filter({ hasText: carrying });
  const card = nodes.first().locator('.we-graph__card');
  try {
    await card.waitFor({ timeout });
  } catch (error) {
    const titles = await page
      .locator('.we-graph__node')
      .evaluateAll((els) => els.map((el) => el.getAttribute('title')).filter(Boolean));
    const which = [`"${title}"`, type ? `of type ${type}` : '', carrying ? `carrying "${carrying}"` : '']
      .filter(Boolean)
      .join(' ');
    throw new Error(`No canvas card titled exactly ${which}. The canvas has: ${titles.join(' | ') || '(none)'}`, {
      cause: error,
    });
  }
  // Forced: the canvas's surface lies over its cards and finds the card under the pointer itself, so
  // the press lands on the surface at the card's place — as a person's does.
  await card.click({ force: true });
}
