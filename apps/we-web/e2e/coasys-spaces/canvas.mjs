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
 * A point on `card` where a press starts a drag of that card.
 *
 * The call's stage floats above the canvas and stays there for the whole call. A tray card in the
 * bottom row can have its centre under that stage, so a press at the centre lands on the stage and
 * no drag starts (nightly coasys-spaces #91692). The centre is tried first, then a point in the
 * upper third, then the top-left. The first one that is really the card is the one to drag from,
 * which leaves an uncovered card on the same point as before.
 *
 * A point is the card when `elementFromPoint` hits the card or a descendant, including one inside
 * an open shadow root. It is also the card when the hit is the canvas surface and the point lies
 * in the card's box: the node layer does not take the pointer, and the surface is what a press on
 * the card reaches. A stage, a button or any other panel is neither, so it is not a place to press.
 *
 * When none of the three is free, the stage is dragged off by its "Move panel" grip, or the canvas
 * is panned so the card leaves whatever covers it, and the three points are tried once more. Still
 * covered, this throws and names the element on the centre, instead of waiting on a placement that
 * will never be written.
 *
 * @returns {{ name: string, x: number, y: number }} viewport coordinates for `page.mouse`
 */
export async function pointOnCard(page, card, title = 'the card') {
  let read = await readCard(card);
  let moved = false;
  if (!read.point && read.recovery) {
    const how = read.recovery.kind === 'panel' ? 'moving the panel off it' : 'panning the canvas';
    console.log(`[coasys-spaces] "${title}" is covered (${read.cover}); ${how}`);
    await gesture(page, read.recovery);
    moved = true;
    read = await readCard(card);
  }
  if (!read.point) {
    throw new Error(
      `"${title}" is covered at its centre, its upper third and its top-left; the centre is under ${read.cover}`,
    );
  }
  const covered = read.point.name === 'centre' ? '' : `; the centre is under ${read.centreCover}`;
  const after = moved ? ' after moving what covered it' : '';
  console.log(`[coasys-spaces] drag "${title}" from its ${read.point.name}${after}${covered}`);
  return read.point;
}

/** Press, drag and release. The element under the press captures the pointer, as the stage's grip does. */
async function gesture(page, move) {
  await page.mouse.move(move.x, move.y);
  await page.mouse.down();
  try {
    await page.mouse.move(move.x + move.dx, move.y + move.dy, { steps: 12 });
  } finally {
    await page.mouse.up();
  }
}

/**
 * Which sample point is the card, and how to get the cover out of the way when none is.
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

    const parentOf = (node) => {
      if (node.parentElement) return node.parentElement;
      if (node.parentNode instanceof ShadowRoot) return node.parentNode.host;
      return null;
    };

    /**
     * The card or a descendant. `contains` is that check, and it stops at a shadow root, so a hit
     * inside an open shadow (a card's own text) is followed out through each host.
     */
    const onCard = (hit) => {
      if (!hit) return false;
      if (el.contains(hit)) return true;
      let node = hit;
      while (node) {
        if (node === el) return true;
        node = parentOf(node);
      }
      return false;
    };

    /**
     * The canvas surface, and the point is inside the card's box.
     *
     * Where the card does not take the pointer, this is the element a press on the card hits, and
     * the graph picks the card from the point. A panel above the card is not the surface.
     */
    const onSurface = (hit, x, y) => {
      const surface = el.closest('.we-graph')?.querySelector('.we-graph__surface');
      if (!surface || (hit !== surface && !surface.contains(hit))) return false;
      return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
    };

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
      if (sample.name === 'centre') {
        const owned = hit && (onCard(hit) || onSurface(hit, sample.x, sample.y));
        centreCover = owned ? '' : describe(hit);
      }
      if (hit && (onCard(hit) || onSurface(hit, sample.x, sample.y))) {
        return { point: sample, cover: centreCover || describe(hit), centreCover, recovery: null };
      }
    }

    const centre = samples[0];
    const coverHit = hitAt(centre.x, centre.y);
    const cover = coverHit ? describe(coverHit) : 'nothing';

    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

    /** The smallest move that puts `box` clear of `obstacle`, preferring one that stays on screen. */
    const separate = (box, obstacle) => {
      const options = [
        { dx: obstacle.right + 12 - box.left, dy: 0 },
        { dx: obstacle.left - 12 - box.right, dy: 0 },
        { dx: 0, dy: obstacle.bottom + 12 - box.top },
        { dx: 0, dy: obstacle.top - 12 - box.bottom },
      ];
      const cost = (d) => Math.abs(d.dx) + Math.abs(d.dy);
      const fits = (d) => {
        const left = box.left + d.dx;
        const top = box.top + d.dy;
        return left >= 0 && top >= 0 && left + box.width <= window.innerWidth && top + box.height <= window.innerHeight;
      };
      options.sort((a, b) => Number(fits(b)) - Number(fits(a)) || cost(a) - cost(b));
      return options[0];
    };

    const chain = (start) => {
      const list = [];
      let node = start;
      while (node && !list.includes(node)) {
        list.push(node);
        node = parentOf(node);
      }
      return list;
    };

    const frame =
      coverHit && chain(coverHit).find((node) => node instanceof Element && node.hasAttribute('data-we-dock-frame'));
    const grips = frame ? [...frame.querySelectorAll('we-move-handle')] : [];
    const grip = grips
      .filter((node) => node.getAttribute('aria-label') === 'Move panel')
      .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (grip && frame) {
      const from = grip.getBoundingClientRect();
      const delta = separate(frame.getBoundingClientRect(), rect);
      return {
        point: null,
        cover,
        centreCover: cover,
        recovery: { kind: 'panel', x: from.left + from.width / 2, y: from.top + from.height / 2, ...delta },
      };
    }

    const graph = el.closest('.we-graph');
    const surface = graph?.querySelector('.we-graph__surface');
    const cards = graph
      ? [...graph.querySelectorAll('.we-graph__card')].map((node) => node.getBoundingClientRect())
      : [];

    /** The largest ancestor of the cover that overlaps the card, skipping the page itself. */
    const largestCover = (hit) => {
      let best = hit.getBoundingClientRect();
      for (const node of chain(hit)) {
        if (!(node instanceof Element) || node === document.body || node === document.documentElement) continue;
        const box = node.getBoundingClientRect();
        const pageSized = box.width > window.innerWidth * 0.92 && box.height > window.innerHeight * 0.92;
        if (pageSized || !overlaps(box, rect)) continue;
        if (box.width * box.height > best.width * best.height) best = box;
      }
      return best;
    };

    /** A point of the surface that is not on a card, from which the pan still ends on screen. */
    const emptySpot = (surfaceEl, delta) => {
      const area = surfaceEl.getBoundingClientRect();
      const overCard = (x, y) => cards.some((box) => x >= box.left && x < box.right && y >= box.top && y < box.bottom);
      let fallback = null;
      for (let row = 1; row <= 5; row += 1) {
        for (let column = 1; column <= 5; column += 1) {
          const x = area.left + (area.width * column) / 6;
          const y = area.top + (area.height * row) / 6;
          if (!inView(x, y) || overCard(x, y)) continue;
          const hit = document.elementFromPoint(x, y);
          if (hit !== surfaceEl && !surfaceEl.contains(hit)) continue;
          const endX = x + delta.dx;
          const endY = y + delta.dy;
          if (inView(endX, endY)) return { x, y };
          fallback ??= { x, y };
        }
      }
      return fallback;
    };

    const shift = coverHit ? separate(rect, largestCover(coverHit)) : null;
    const spot = surface && shift ? emptySpot(surface, shift) : null;
    if (!spot || !shift || Math.abs(shift.dx) + Math.abs(shift.dy) < 8) {
      return { point: null, cover, centreCover: cover, recovery: null };
    }
    return { point: null, cover, centreCover: cover, recovery: { kind: 'pan', ...spot, ...shift } };
  });
}
