/**
 * Chat lines as bots write them: whatever a line carries, it reads as written.
 *
 * - A line break in the stored text is a line break on screen, with marks or without. A line with no
 *   marks used to be drawn as plain text, which folded every break into a space.
 * - A bare URL is a link, whether or not its writer marked it, and stops before the full stop that
 *   ends its sentence.
 * - A mention the writer marked stays a mention.
 */
export const name = 'chat lines as written';
export const scenario = 'feed:rich';
export const widths = [560];

/** Whether `needle` starts a visual line inside the element that holds it. */
async function startsLine(evaluate, needle) {
  return evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const stack = [document.body];
    // Text inside shadow roots and slots both count: walk every root.
    const roots = [document];
    for (const el of document.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    for (const root of roots) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const at = n.textContent.indexOf(needle);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + 1);
        const glyph = range.getBoundingClientRect();
        if (!glyph.width) continue;
        // The text before it on the same line, if any: one character back.
        if (at === 0) return true;
        const before = document.createRange();
        before.setStart(n, at - 1);
        before.setEnd(n, at);
        const prev = before.getClientRects();
        const last = prev[prev.length - 1];
        return !last || last.top + 1 < glyph.top;
      }
    }
    void walker;
    void stack;
    return null;
  }, needle);
}

export async function check({ evaluate, screenshot }) {
  const problems = [];
  await new Promise((r) => setTimeout(r, 150));
  await screenshot?.('rich-lines');

  for (const needle of ['Before merge:', '(B-2)', 'The one from this morning.', '2. integration-tests-agent']) {
    const starts = await startsLine(evaluate, needle);
    if (starts === null) problems.push(`"${needle}" is not drawn`);
    else if (!starts) problems.push(`"${needle}" does not start a line: the break before it was folded`);
  }

  const links = await evaluate(() => {
    const anchors = [];
    const roots = [document];
    for (const el of document.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    for (const root of roots) for (const a of root.querySelectorAll('a[href]')) anchors.push(a.getAttribute('href'));
    return anchors;
  });
  for (const href of [
    'https://github.com/coasys/ad4m/pull/1861#pullrequestreview-6006889289',
    'https://github.com/HexaField/sovereign/pull/19',
    'https://example.org/nightly-1121.log',
  ])
    if (!links.includes(href)) problems.push(`no link to ${href} (links: ${links.join(', ') || 'none'})`);
  if (links.some((h) => /[.)]$/.test(h))) problems.push(`a link took the punctuation after it: ${links.join(', ')}`);

  const mentions = await evaluate(() => document.querySelectorAll('.we-mention, [data-mention], [data-did]').length);
  if (mentions < 4) problems.push(`${mentions} mentions drawn, where the lines mark 4`);

  return problems;
}
