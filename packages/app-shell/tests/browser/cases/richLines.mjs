/**
 * Chat lines as bots write them: whatever a line carries, it reads as written.
 *
 * - A line break in the stored text is a line break on screen, with marks or without. A line with no
 *   marks used to be drawn as plain text, which folded every break into a space.
 * - A bare URL is a link, whether or not its writer marked it, and stops before the full stop that
 *   ends its sentence.
 * - A mention the writer marked stays a mention.
 * - A typed line is read as markdown: a bot's `1.` and `- ` lines are a list, with no flag saying
 *   so. (A spoken line is drawn as said; `lineContent`'s own tests hold that, since the Feed hides
 *   spoken lines unless call transcripts are shown.)
 * - A line written in markdown is drawn as what the markdown says: a heading, a list, code — and its
 *   mention still a mention.
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
  // The Feed keeps its filter on the device (`feed.show`), and the case before may have left it on
  // Bots, which hides the one person's line here.
  await evaluate(() =>
    [...document.querySelectorAll('we-button')].find((b) => b.textContent.trim() === 'Everything')?.click(),
  );
  await new Promise((r) => setTimeout(r, 150));
  await screenshot?.('rich-lines');

  for (const needle of ['Before merge:', '(B-2)', 'The one from this morning.']) {
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

  const md = await evaluate(() => ({
    heading: [...document.querySelectorAll('h1, h2, h3')].some((h) => h.textContent.includes('Nightly on dev')),
    // Flat list items, as the composer writes them — and with room for the bullet drawn beside them.
    list: [...document.querySelectorAll('.we-list-item')].some((li) =>
      li.textContent.includes('integration-tests-sfu'),
    ),
    code: [...document.querySelectorAll('code')].some((c) => c.textContent.includes('docker: command not found')),
    raw: document.body.innerText.includes('**Only llm-e2e'),
  }));
  if (!md.heading) problems.push('the markdown heading is not a heading');
  if (!md.list) problems.push('the markdown list is not a list');
  const inset = await evaluate(() => {
    const item = [...document.querySelectorAll('.we-block-content--compact .we-list-item')][0];
    const para = [...document.querySelectorAll('.we-block-content--compact p')].find((p) =>
      p.textContent.includes('Before merge'),
    );
    return {
      item: item ? parseFloat(getComputedStyle(item).paddingLeft) : null,
      para: para ? parseFloat(getComputedStyle(para).paddingLeft) : null,
    };
  });
  // A heading in a line is a step above its words, not a document's title over the byline.
  const sizes = await evaluate(() => {
    const h = [...document.querySelectorAll('.we-block-content--compact :is(h1, h2, h3)')].find((el) =>
      el.textContent.includes('Nightly on dev'),
    );
    const p = [...document.querySelectorAll('.we-block-content--compact p')][0];
    return h && p ? { h: parseFloat(getComputedStyle(h).fontSize), p: parseFloat(getComputedStyle(p).fontSize) } : null;
  });
  if (sizes && sizes.h > sizes.p * 1.3)
    problems.push(`a heading in a line is ${sizes.h}px over ${sizes.p}px words: a document's size, not a line's`);
  // A compact line's words sit flush with the byline, but a bullet is drawn into the inset at 10px.
  if (inset.item !== null && inset.item < 20) problems.push(`a list item in a line has ${inset.item}px for its bullet`);
  if (inset.para !== 0) problems.push(`a paragraph in a line is inset ${inset.para}px from the byline`);
  if (!md.code) problems.push('the markdown code is not code');
  if (md.raw) problems.push('the markdown is drawn as its source');

  const plainLists = await evaluate(() => {
    const items = [...document.querySelectorAll('.we-list-item')].map((el) => el.textContent.trim());
    return {
      data: ['ad4m#1868', 'ad4m#1887', 'we#549', 'integration-tests-agent-harness', '3d24040a', '7565250c'].map((w) =>
        items.some((t) => t.includes(w)),
      ),
      // A line back at the margin after a list is a paragraph of its own, not part of the last item.
      swallowed: ['Also open but less urgent', 'Marvin has the ICE'].filter((w) => items.some((t) => t.includes(w))),
    };
  });
  if (plainLists.data.includes(false))
    problems.push(`a bot's list lines are not all list items: ${JSON.stringify(plainLists.data)}`);
  for (const w of plainLists.swallowed) problems.push(`"${w}…" was drawn inside the list item above it`);
  return problems;
}
