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

/**
 * The call stage's titlebar grip — `data-we-panel-grip` on the "Move panel" handle
 * (`dockRegistry.ts`). Corner grips resize; this one moves the panel.
 */
const STAGE_GRIP = '[data-we-panel-grip="call:stage"]';

/**
 * Parks the in-call stage in the bottom-right before a tray card is dragged.
 *
 * The stage opens centred on the bottom edge and covers the lower tray (nightly coasys-spaces
 * #91692). One drag of its own grip, to the bottom-right landing marker the shell draws while
 * that drag is held. The pointer is what the shell snaps to, and that marker is the corner, so
 * the drop is the corner rather than a full-width lane along the edge.
 *
 * A page that draws no markers — the helper's own test, when it has not planted one — gets a
 * point in that same corner. The shell eases the frame into place after the pointer goes up.
 * The wait is that ease.
 */
export async function parkCallStage(page) {
  const grip = page.locator(STAGE_GRIP);
  await grip.waitFor({ timeout: 30_000 });
  const box = await grip.boundingBox();
  if (!box) throw new Error('the call stage grip has no box');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  let spot;
  try {
    // Far enough that the drag has started and the shell has drawn its markers.
    const open = await page.evaluate(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));
    await page.mouse.move(open.x, open.y, { steps: 8 });
    spot = await page.evaluate(async () => {
      const cornerMarker = () => {
        const boxes = [];
        const walk = (root) => {
          for (const el of root.querySelectorAll('*')) {
            boxes.push(el);
            if (el.shadowRoot) walk(el.shadowRoot);
          }
        };
        walk(document);
        let best = null;
        let bestDistance = Infinity;
        const corner = { x: window.innerWidth, y: window.innerHeight };
        for (const el of boxes) {
          const style = getComputedStyle(el);
          if (style.position !== 'fixed' || style.pointerEvents !== 'none') continue;
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 60 || rect.height < 48) continue;
          if (rect.width > window.innerWidth * 0.4 || rect.height > window.innerHeight * 0.4) continue;
          const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          if (centre.x < window.innerWidth * 0.62 || centre.y < window.innerHeight * 0.55) continue;
          const distance = (centre.x - corner.x) ** 2 + (centre.y - corner.y) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = centre;
          }
        }
        return best;
      };
      // The markers are drawn on the frame after the drag starts. Give that paint a few frames.
      let found = cornerMarker();
      for (let frame = 0; !found && frame < 12; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        found = cornerMarker();
      }
      return found ?? { x: window.innerWidth - 80, y: window.innerHeight - 120 };
    });
    await page.mouse.move(spot.x, spot.y, { steps: 12 });
  } finally {
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  console.log(`[coasys-spaces] moved the call stage by its grip toward (${Math.round(spot.x)}, ${Math.round(spot.y)})`);
}

/**
 * A point on `card` where a press starts a drag of that card.
 *
 * The graph handles the gesture on `.we-graph__surface`, which is what a press on a card reaches:
 * the node layer sets `pointer-events: none` and the card inherits it. A descendant that turns the
 * pointer back on would take the press itself, so it is not a place to drag from. The centre is
 * tried first, then the upper third, then the top-left. The first one whose hit is the surface,
 * and which lies in the card's box, is the point.
 *
 * Still covered, this throws and names the element on the centre, instead of waiting on a placement
 * that will never be written. Moving the call stage out of the way is `parkCallStage`, done once
 * before this is asked.
 *
 * @returns {{ name: string, x: number, y: number }} viewport coordinates for `page.mouse`
 */
export async function pointOnCard(page, card, title = 'the card') {
  const read = await readCard(card);
  if (!read.point) {
    throw new Error(
      `"${title}" is covered at its centre, its upper third and its top-left; the centre is under ${read.cover}`,
    );
  }
  const covered = read.point.name === 'centre' ? '' : `; the centre is under ${read.centreCover}`;
  console.log(`[coasys-spaces] drag "${title}" from its ${read.point.name}${covered}`);
  return read.point;
}

/**
 * Which sample point is the surface inside the card's box.
 * Runs in the page: `elementFromPoint` is the same hit the next press will land on.
 */
function readCard(card) {
  return card.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const inset = (span) => Math.min(16, Math.max(4, span / 5));
    const samples = [
      { name: 'centre', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { name: 'upper third', x: rect.left + rect.width / 2, y: rect.top + rect.height / 6 },
      { name: 'top-left', x: rect.left + inset(rect.width), y: rect.top + inset(rect.height) },
    ];

    const surface = el.closest('.we-graph')?.querySelector('.we-graph__surface') ?? null;

    const parentOf = (node) => {
      if (node.parentElement) return node.parentElement;
      if (node.parentNode instanceof ShadowRoot) return node.parentNode.host;
      return null;
    };

    /** The surface itself, and the point is inside the card's box. A card's own descendant is not. */
    const onSurface = (hit, x, y) =>
      Boolean(surface) && hit === surface && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;

    const inView = (x, y) => x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;

    /** Tag, up to three classes, and the aria-label — of the hit, or the nearest ancestor that has either. */
    const describe = (hit) => {
      let node = hit;
      while (node && node.nodeType === 1) {
        const cls = typeof node.className === 'string' ? node.className.trim() : '';
        const label = node.getAttribute('aria-label');
        if (cls || label) {
          const classes = cls
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 3)
            .map((name) => `.${name}`)
            .join('');
          return `${node.tagName.toLowerCase()}${classes}${label ? `[aria-label="${label}"]` : ''}`;
        }
        node = parentOf(node);
      }
      return hit?.tagName ? hit.tagName.toLowerCase() : 'nothing';
    };

    const hitAt = (x, y) => (inView(x, y) ? document.elementFromPoint(x, y) : null);

    let centreCover = 'nothing';
    for (const sample of samples) {
      const hit = hitAt(sample.x, sample.y);
      if (sample.name === 'centre') centreCover = onSurface(hit, sample.x, sample.y) ? '' : describe(hit);
      if (onSurface(hit, sample.x, sample.y)) {
        return { point: sample, cover: centreCover || describe(hit), centreCover };
      }
    }

    const centre = samples[0];
    const coverHit = hitAt(centre.x, centre.y);
    const cover = coverHit ? describe(coverHit) : 'nothing';
    return { point: null, cover, centreCover: cover };
  });
}
