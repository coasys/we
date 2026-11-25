/**
 * Time marks taken in the page, for the timings the suite reports (`timings.mjs`).
 *
 * Playwright's waits poll from Node, and a step's wait ends some time after the page showed what it
 * waited for. So the page marks its own times. A mark is epoch milliseconds
 * (`performance.timeOrigin + performance.now()`), the clock `Date.now()` reads in Node on the same
 * machine, so a start taken in Node and an end taken in the page subtract.
 *
 * - {@link watchPage} marks the first frame in which the page shows what a spec says (or no longer
 *   shows it). The check runs once per frame, so a mark is exact to about one frame.
 * - {@link markClick} marks the first click on a control, as the browser stamped the event.
 * - {@link timeInput} times an input to the change it makes: from the event's own stamp to the frame
 *   after the change was painted. For the graph's gestures, which take tens of milliseconds.
 *
 * Every function here takes a page, arms something in it and returns at once. A mark that was never
 * taken is `null`: a page that navigated, or a control that was not there. Callers record nothing for it.
 */

/**
 * Arms a watch: `marks[name]` is set, once, in the first frame in which `spec` holds. See {@link watchPage}.
 *
 * Every watch of the page shares one loop, which reads the page once a frame: the shadow roots once,
 * and each selector's elements and their text once, whatever the number of watches. The loop stops
 * when no watch is left, so what is measured after the watches pays nothing for them.
 */
function armWatch({ name, spec }) {
  const probe = (window.__spacesProbe ??= { marks: {}, inputs: {} });
  delete probe.marks[name];
  // Arming a name again replaces the watch it had.
  const watches = (probe.watches ??= new Map());
  watches.set(name, { spec, giveUp: spec.within === null ? Infinity : performance.now() + (spec.within ?? 120_000) });
  if (probe.looping) return;
  probe.looping = true;

  const deepText = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    let out = '';
    if (node.shadowRoot) out += deepText(node.shadowRoot);
    for (const child of node.childNodes) out += ` ${deepText(child)}`;
    return out;
  };
  const shadowRoots = (root = document, found = [document]) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        found.push(el.shadowRoot);
        shadowRoots(el.shadowRoot, found);
      }
    }
    return found;
  };
  // One frame's reading of the page: for each selector, the text of each match and its name where
  // the name is an attribute (a button's `label`), lower case.
  const reader = () => {
    const roots = shadowRoots();
    const bySelector = new Map();
    return (selector) => {
      if (!bySelector.has(selector)) {
        const shown = roots
          .flatMap((root) => [...root.querySelectorAll(selector)])
          .map((el) => [deepText(el), el.getAttribute('aria-label'), el.getAttribute('label')].join(' ').toLowerCase());
        bySelector.set(selector, shown);
      }
      return bySelector.get(selector);
    };
  };
  const holds = (name, spec, shownBy) => {
    const shown = shownBy(spec.selector ?? 'body');
    const texts = (spec.texts ?? []).map((t) => t.toLowerCase());
    const has = (t) => shown.some((s) => s.includes(t));
    // A count the page shows ("Interpretation, 5 suggestions"): the frame in which each number first showed.
    if (spec.counted) {
      for (const s of shown) {
        const n = s.match(/\d+/)?.[0];
        if (n && texts.some((t) => s.includes(t)))
          probe.marks[`${name}#${n}`] ??= performance.timeOrigin + performance.now();
      }
      return false;
    }
    const present = texts.length ? (spec.all ? texts.every(has) : texts.some(has)) : shown.length > 0;
    return spec.gone ? !present : present;
  };
  const frame = () => {
    const now = performance.now();
    // A watch that never holds stops reading the page after `within`.
    for (const [n, w] of watches) if (now > w.giveUp) watches.delete(n);
    if (!watches.size) {
      probe.looping = false;
      return;
    }
    const shownBy = reader();
    for (const [n, w] of watches) {
      if (holds(n, w.spec, shownBy)) {
        probe.marks[n] = performance.timeOrigin + performance.now();
        watches.delete(n);
      }
    }
    requestAnimationFrame(frame);
  };
  frame();
}

/**
 * Marks, in the page, the first frame in which `spec` holds.
 *
 * `spec.selector` (default `body`) names the elements to look in, shadow roots included.
 * `spec.texts` are looked for in their text and in their `aria-label` or `label`, without case: any one of them, or every one with `spec.all`.
 * With no `texts`, the selector alone must match something. `spec.gone` turns it round: the mark is
 * taken when the page no longer shows it. With `spec.counted` there is no mark of `name`: the first
 * number in the text of a match is the count, and `name#<n>` is marked in the frame it first showed.
 * `spec.within` (default 120000) is how long the watch reads
 * the page; `null` is until {@link endWatches}. A spec that already holds is marked at once, before any start a caller takes after it, and
 * {@link ms} drops that.
 */
export function watchPage(page, name, spec) {
  return page.evaluate(armWatch, { name, spec });
}

/** Ends every watch of the page, so the loop stops reading it. The marks already taken stay. */
export function endWatches(page) {
  return page.evaluate(() => window.__spacesProbe?.watches?.clear()).catch(() => {});
}

/** Marks, in the page, the first click, after this call, on a control named `label` (its `aria-label`, `title` or its text). */
export function markClick(page, name, label) {
  return page.evaluate(
    ({ name, label }) => {
      const probe = (window.__spacesProbe ??= { marks: {}, inputs: {} });
      delete probe.marks[name];
      const named = (el) =>
        el.getAttribute?.('aria-label') === label ||
        el.getAttribute?.('title') === label ||
        el.textContent?.trim() === label;
      window.addEventListener(
        'click',
        (event) => {
          if (event.composedPath().slice(0, 8).some(named))
            probe.marks[name] ??= performance.timeOrigin + event.timeStamp;
        },
        { capture: true, once: false, signal: AbortSignal.timeout(600_000) },
      );
    },
    { name, label },
  );
}

/** A mark taken by {@link watchPage} or {@link markClick}, or `null` if it was not taken. */
export function readMark(page, name) {
  return page.evaluate((n) => window.__spacesProbe?.marks[n] ?? null, name).catch(() => null);
}

/** The time from `start` to `end` (epoch ms), or `null` when either is missing or the end came first. */
export function ms(start, end) {
  if (typeof start !== 'number' || typeof end !== 'number' || end < start) return null;
  return end - start;
}

/** How many inputs have been armed, for each one's token. */
let armed = 0;

/**
 * Times the next input of a kind to the change it makes. Arms the page, runs `perform` (which makes
 * the input with the page's mouse) and resolves with the milliseconds, or `null` if nothing changed
 * in `within` ms after it. Whether it resolves or throws, the observer, the listener and the ports it
 * armed are gone from the page.
 *
 * - `input` — the event type that starts the clock (`pointermove`, `pointerup`, `wheel`): its own
 *   `timeStamp`, when the browser took the input.
 * - `change` — `{selector, attribute, className}`: the first mutation of `attribute` on an element
 *   matching `selector` (and, with `className`, that now has the class) is the change.
 *
 * The end is the first message after the frame that follows the change: the change has been painted,
 * as far as a page can know.
 */
export async function timeInput(page, { input, change }, perform, within = 3_000) {
  // Each attempt has its own token, so what an attempt leaves in the page can never be read as another's.
  const token = `${input}:${change.selector}:${change.attribute}:${++armed}`;
  await page.evaluate(
    ({ token, input, change }) => {
      const probe = (window.__spacesProbe ??= { marks: {}, inputs: {} });
      probe.inputs[token] = { done: false, ms: null };
      let started = null;
      const stop = new AbortController();
      window.addEventListener(
        input,
        (event) => {
          started ??= event.timeStamp;
        },
        { capture: true, passive: true, signal: stop.signal },
      );
      const channel = new MessageChannel();
      const observer = new MutationObserver((records) => {
        const hit = records.some((r) => {
          const el = r.target;
          if (!el.matches?.(change.selector)) return false;
          return change.className ? el.classList.contains(change.className) : true;
        });
        if (!hit || started === null) return;
        observer.disconnect();
        channel.port1.onmessage = () => {
          probe.inputs[token] = { done: true, ms: performance.now() - started };
        };
        requestAnimationFrame(() => channel.port2.postMessage(0));
      });
      observer.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: [change.attribute],
      });
      (probe.cleanups ??= {})[token] = () => {
        observer.disconnect();
        stop.abort();
        channel.port1.close();
        channel.port2.close();
        delete probe.inputs[token];
        delete probe.cleanups[token];
      };
    },
    { token, input, change },
  );
  try {
    await perform();
    return await page
      .waitForFunction((t) => window.__spacesProbe.inputs[t]?.done, token, { timeout: within, polling: 'raf' })
      .then(() => page.evaluate((t) => window.__spacesProbe.inputs[t].ms, token))
      .catch(() => null);
  } finally {
    // Whatever ended the attempt, a timeout or a throw included, nothing of it is left running in the page.
    await page.evaluate((t) => window.__spacesProbe?.cleanups?.[t]?.(), token).catch(() => {});
  }
}

/**
 * Drives the canvas as a person does, with the page's mouse, and times each gesture in the page:
 * wheel to zoom, drag the background to pan, drag a node, click a node. Each runs `rounds` times.
 * Calls `report(kind, ms)` for every gesture that changed the canvas; one that changed nothing (no
 * empty ground to press, no node under the pointer) reports nothing. Needs `.we-graph` on the screen.
 */
export async function timeCanvas(page, report, rounds = 5) {
  const spot = (find) => page.evaluate(find).catch(() => null);
  // The canvas's own box and a point of its bare ground: the topmost element there is the hit surface.
  const ground = () =>
    spot(() => {
      const box = document.querySelector('.we-graph')?.getBoundingClientRect();
      if (!box) return null;
      for (let fy = 0.9; fy > 0.1; fy -= 0.1) {
        for (let fx = 0.1; fx < 0.95; fx += 0.1) {
          const x = box.left + box.width * fx;
          const y = box.top + box.height * fy;
          if (!document.elementFromPoint(x, y)?.classList.contains('we-graph__surface')) continue;
          // Not on a card: the surface answers under cards too, and a press there would drag the node.
          const onCard = [...document.querySelectorAll('.we-graph__card')].some((c) => {
            const r = c.getBoundingClientRect();
            return x > r.left - 8 && x < r.right + 8 && y > r.top - 8 && y < r.bottom + 8;
          });
          if (!onCard) return { x, y, box: { w: box.width, h: box.height } };
        }
      }
      return null;
    });
  // A node whose centre is on the screen and is what the pointer would reach there. A card's node is
  // only its anchor point; the card, inside it, is what has a size.
  const node = () =>
    spot(() => {
      for (const anchor of document.querySelectorAll('.we-graph__node')) {
        const el = anchor.querySelector('.we-graph__card') ?? anchor;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        // Cards do not take the pointer; the hit surface under them does, and finds the node by position.
        if (top && (el.contains(top) || top.classList.contains('we-graph__surface'))) return { x, y };
      }
      return null;
    });
  const LAYER = { selector: '.we-graph__layer', attribute: 'style' };
  // A drag with the button down for the length of `gesture`, and released when it throws too.
  const pressed = async (at, gesture) => {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    try {
      return await gesture();
    } finally {
      await page.mouse.up();
    }
  };

  const bare = await ground();
  if (bare) {
    for (let i = 0; i < rounds; i++) {
      const t = await timeInput(page, { input: 'wheel', change: LAYER }, async () => {
        await page.mouse.move(bare.x, bare.y);
        await page.mouse.wheel(0, i % 2 ? 120 : -120);
      });
      if (t !== null) report('zoom', t);
    }
    for (let i = 0; i < rounds; i++) {
      const t = await pressed(bare, () =>
        timeInput(page, { input: 'pointermove', change: LAYER }, () =>
          page.mouse.move(bare.x + (i % 2 ? -40 : 40), bare.y),
        ),
      );
      if (t !== null) report('pan', t);
    }
  }
  const held = await node();
  if (held) {
    for (let i = 0; i < rounds; i++) {
      const at = (await node()) ?? held;
      const t = await pressed(at, () =>
        timeInput(page, { input: 'pointermove', change: { selector: '.we-graph__node', attribute: 'style' } }, () =>
          page.mouse.move(at.x + (i % 2 ? -30 : 30), at.y + 20),
        ),
      );
      if (t !== null) report('drag', t);
    }
    for (let i = 0; i < rounds; i++) {
      const at = (await node()) ?? held;
      const away = await ground();
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      const t = await timeInput(
        page,
        {
          input: 'pointerup',
          change: { selector: '.we-graph__node', attribute: 'class', className: 'we-graph__node--selected' },
        },
        () => page.mouse.up(),
      ).catch(async (error) => {
        // The button is still down if arming failed before the release.
        await page.mouse.up().catch(() => {});
        throw error;
      });
      if (t !== null) report('select', t);
      // Back to nothing selected, so the next round selects again.
      if (away) await page.mouse.click(away.x, away.y);
    }
  }
}
