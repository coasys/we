/**
 * The Coasys About page's header: the name beside the logo is one word on one line.
 *
 * Found on a real phone: upright (412px window) the page's column beside the rail is about 348px,
 * and the name broke inside itself as "coasy / s". The typography layer lets a word break anywhere
 * (`overflow-wrap: anywhere`, right for a DID or a URL), so in a header row short of room the name was
 * the box that gave way, not the room around it.
 *
 * `WE_BROWSER_SHOTS=<dir>` also writes a picture.
 */
export const name = 'the Coasys wordmark';
export const scenario = 'coasys:about';
// `scale` is the window's width and `width` the mount's: a phone held upright, beside the rail and
// without it, and the narrowest phone.
export const scales = [412];
export const widths = [412, 348, 300];

export async function check({ evaluate, screenshot }, width) {
  const problems = [];
  if (width === 348) await screenshot('coasys-wordmark-phone');
  const lines = await evaluate(() => {
    const link = [...document.querySelectorAll('we-link')].find((l) =>
      [...l.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() === 'coasys'),
    );
    if (!link) return null;
    const text = [...link.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() === 'coasys');
    const range = document.createRange();
    range.selectNodeContents(text);
    const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
    return tops.size;
  });
  if (lines === null) problems.push('no "coasys" beside the logo');
  else if (lines !== 1) problems.push(`"coasys" beside the logo is on ${lines} lines at ${width}px`);
  return problems;
}
