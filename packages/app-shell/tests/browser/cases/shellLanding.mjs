/**
 * WE's landing headline breaks between words, never inside one.
 *
 * At 52px "infrastructure" is wider than a phone's column beside the rail, so on a phone held
 * upright (412px) the browser broke it inside the word — "infrastruct / ure", and "cooperativ" cut
 * at the frame's edge. The headline's size now follows the window, down to where the longest word
 * fits, and is the 52px it was at a desktop width.
 *
 * `WE_BROWSER_SHOTS=<dir>` also writes a picture at each width.
 */
export const name = 'the landing headline';
export const scenario = 'shell:landing';
// `scale` is the window's width and `width` the mount's; only the matching pairs are a window.
export const widths = [1280, 412, 360];
export const scales = [1280, 412, 360];

const HEADLINE_WORDS = ['Social', 'infrastructure', 'for', 'a', 'more', 'cooperative', 'world.'];

export async function check({ evaluate, measure, screenshot }, width, scale) {
  if (width !== scale) return [];
  const problems = [];
  await screenshot(width < 640 ? 'landing-phone' : 'landing-desktop');

  const frame = await measure('#landing-frame');
  const words = await evaluate((wanted) => {
    // The headline's two lines: "Social infrastructure" (with its inline gradient word) and the next.
    const hosts = [...document.querySelectorAll('we-text')].filter((t) =>
      /^(Social\s+infrastructure|for a more cooperative world\.)$/.test((t.textContent ?? '').trim()),
    );
    const found = [];
    for (const host of hosts) {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (const match of text.matchAll(/\S+/g)) {
          if (!wanted.includes(match[0])) continue;
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          const box = range.getBoundingClientRect();
          // The size is set on the element in the we-text's shadow root that holds the slot the
          // text is drawn through; the host itself keeps the page's.
          const owner = node.parentElement;
          const drawnIn = owner.shadowRoot?.querySelector('slot')?.parentElement ?? owner;
          found.push({
            word: match[0],
            lines: new Set(rects.map((r) => Math.round(r.top))).size,
            left: box.left,
            right: box.right,
            fontSize: parseFloat(getComputedStyle(drawnIn).fontSize),
            // What the word needs on one line, and what the headline's line has.
            needs: Math.round(rects.reduce((sum, r) => sum + r.width, 0)),
            has: Math.round(host.shadowRoot?.querySelector('slot')?.parentElement?.getBoundingClientRect().width ?? 0),
          });
        }
      }
    }
    return found;
  }, HEADLINE_WORDS);

  const seen = new Set(words.map((w) => w.word));
  for (const word of HEADLINE_WORDS) if (!seen.has(word)) problems.push(`the headline has no "${word}"`);
  for (const w of words) {
    if (w.lines > 1) {
      problems.push(
        `"${w.word}" breaks across ${w.lines} lines at ${w.fontSize}px (needs ${w.needs}px, the line has ${w.has}px)`,
      );
    }
    if (frame && (w.left < frame.x - 0.5 || w.right > frame.x + frame.w + 0.5)) {
      problems.push(`"${w.word}" runs past the frame (${w.left}–${w.right}, frame ${frame.x}–${frame.x + frame.w})`);
    }
  }
  // A desktop window keeps the headline it had.
  if (width >= 1024) {
    for (const w of words)
      if (w.fontSize !== 52) problems.push(`at ${width}px "${w.word}" is ${w.fontSize}px, not 52px`);
  }
  return problems;
}
