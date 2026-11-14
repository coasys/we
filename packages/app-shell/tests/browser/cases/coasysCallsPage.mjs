/**
 * The Coasys Calls page: every call's card offers its transcript to take away, as the call's own bar
 * does, and still opens the call.
 *
 * The card was one button, so a second could not sit inside it. Now the card's name side is the
 * button and the export stands beside it, inside the card. Measured, because what can go wrong is
 * where a browser puts things: the export over the title or the Live badge, or off the card.
 */
export const name = 'the Coasys Calls page: each call exports its transcript and opens';
export const scenario = 'coasys:calls-page';
export const widths = [900];

const LABEL = 'Export the transcript';
const TITLES = ['Design review', 'Standup', 'Release planning for the next AD4M version'];
// Each card's export names its call, so a screen reader can tell the row of them apart.
const LABELS = TITLES.map((title) => `${LABEL} of ${title}`);
const IDS = ['call-3', 'call-2', 'call-1'];

export async function check({ evaluate, count, hover, screenshot }) {
  const problems = [];
  await screenshot('coasys-calls-page');

  const buttons = await count(`button[aria-label^="${LABEL}"]`);
  if (buttons !== TITLES.length) problems.push(`${buttons} export buttons for ${TITLES.length} calls`);
  for (const label of LABELS) {
    if ((await count(`button[aria-label="${label}"]`)) !== 1) problems.push(`no export labelled "${label}"`);
  }

  // A button inside a button is invalid HTML, and the inner press would also open the call.
  const nested = await evaluate(() =>
    [...document.querySelectorAll('we-button we-button')].map((b) => b.getAttribute('label') ?? b.textContent),
  );
  if (nested.length) problems.push(`a button inside a button: ${nested.join(', ')}`);

  // Where each export sits against its own card's title and badge.
  const layout = await evaluate(
    ([label, titles]) => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, mid: r.top + r.height / 2 };
      };
      const exports = [...document.querySelectorAll('we-button')].filter((b) =>
        (b.getAttribute('label') ?? b.label ?? '').startsWith(label),
      );
      return titles.map((title) => {
        const text = [...document.querySelectorAll('we-text')].find((t) => (t.textContent ?? '').trim() === title);
        if (!text) return { title, missing: 'title' };
        // The card is the nearest box around the title that also holds one export.
        let card = text.parentElement;
        while (card && !exports.some((e) => card.contains(e))) card = card.parentElement;
        if (!card) return { title, missing: 'export' };
        const exp = exports.find((e) => card.contains(e));
        const badge = card.querySelector('we-badge');
        const stamp = card.querySelector('we-timestamp');
        return {
          title,
          card: box(card),
          text: box(text),
          exp: box(exp),
          badge: badge ? box(badge) : null,
          stamp: stamp ? box(stamp) : null,
          inPress: !!exp.parentElement?.closest('we-button'),
        };
      });
    },
    [LABEL, TITLES],
  );
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const c of layout) {
    if (c.missing) {
      problems.push(`${c.title}: no ${c.missing}`);
      continue;
    }
    if (c.inPress) problems.push(`${c.title}: the export is inside the card's own button`);
    if (overlaps(c.exp, c.text)) problems.push(`${c.title}: the export is over the title`);
    if (c.badge && overlaps(c.exp, c.badge)) problems.push(`${c.title}: the export is over the Live badge`);
    if (c.stamp && overlaps(c.exp, c.stamp)) problems.push(`${c.title}: the export is over the time`);
    if (c.badge && c.stamp && c.stamp.right > c.badge.left)
      problems.push(`${c.title}: the time runs ${Math.round(c.stamp.right - c.badge.left)}px into the Live badge`);
    if (c.exp.left < c.card.left || c.exp.right > c.card.right + 0.5)
      problems.push(`${c.title}: the export is off the card`);
    if (Math.abs(c.exp.mid - c.card.mid) > 1)
      problems.push(`${c.title}: the export's middle is ${Math.round(c.exp.mid - c.card.mid)}px off the card's`);
    if (c.card.right - c.exp.right > 40) problems.push(`${c.title}: the export is not at the card's end`);
  }
  if (!layout.some((c) => c.badge)) problems.push('the running call has no Live badge');

  // The export lit under the pointer, for the picture; the card does not light with it.
  if (buttons) {
    await hover(`button[aria-label^="${LABEL}"]`, 0);
    await screenshot('coasys-calls-page-hover');
  }

  // Each export asks for its own call, and opens nothing.
  for (let i = 0; i < IDS.length; i++) {
    const got = await evaluate(
      async ([label, nth]) => {
        globalThis.__exported = undefined;
        globalThis.__navigated = undefined;
        const b = [...document.querySelectorAll('we-button')].filter((e) =>
          (e.getAttribute('label') ?? e.label ?? '').startsWith(label),
        )[nth];
        if (!b) return { exported: 'no button' };
        b.shadowRoot?.querySelector('button')?.click() ?? b.click();
        await new Promise((r) => setTimeout(r, 50));
        return { exported: globalThis.__exported ?? 'not called', navigated: globalThis.__navigated ?? null };
      },
      [LABEL, i],
    );
    if (got.exported !== IDS[i]) problems.push(`export ${i + 1} gave ${got.exported}, not ${IDS[i]}`);
    if (got.navigated) problems.push(`export ${i + 1} also opened ${got.navigated}`);
  }

  // The card still opens its call: pressing its title navigates to that call.
  const opened = await evaluate(async (title) => {
    globalThis.__navigated = undefined;
    globalThis.__exported = undefined;
    const text = [...document.querySelectorAll('we-text')].find((t) => (t.textContent ?? '').trim() === title);
    text?.click();
    await new Promise((r) => setTimeout(r, 50));
    return { navigated: globalThis.__navigated ?? null, exported: globalThis.__exported ?? null };
  }, TITLES[0]);
  if (!opened.navigated?.includes('id=call-3')) problems.push(`pressing a call's title opened ${opened.navigated}`);
  if (opened.exported) problems.push(`pressing a call's title exported ${opened.exported}`);

  return problems;
}
