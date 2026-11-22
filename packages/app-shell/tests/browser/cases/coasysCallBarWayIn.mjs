/**
 * The way into a running call, in the call page's bar: Join, immediately left of Live, the
 * Interpretation button and the transcript download.
 */
export const name = "a running call's bar: Join, left of Live and the transcript";
export const scenario = 'coasys:call-bar';
export const widths = [900];

/** The bar's way in, named `label`, and what follows it. Shared with the ended case. */
export async function wayIn({ evaluate, screenshot }, shot, label, want) {
  await screenshot?.(shot);
  const order = await evaluate(() =>
    [...document.querySelectorAll('we-button, we-badge')]
      .map((el) => ({
        // An icon button has no text: its name is its `label`, set as a property.
        text: (el.textContent ?? '').trim() || el.getAttribute('label') || el.label || '',
        x: el.getBoundingClientRect().left,
      }))
      .sort((a, b) => a.x - b.x)
      .map((el) => el.text),
  );
  const at = order.indexOf(label);
  if (at < 0) return [`no ${label} in the bar (found ${JSON.stringify(order)})`];
  // Up to the Page / Canvas switch, which ends every view's bar.
  const end = order.indexOf('Page');
  const after = order
    .slice(at + 1, end < 0 ? undefined : end)
    .map((text) => (text.includes('Live') ? 'Live' : text.startsWith('Interpretation') ? 'Interpretation' : 'export'));
  return JSON.stringify(after) === JSON.stringify(want)
    ? []
    : [`after ${order[at]}: ${JSON.stringify(order.slice(at + 1))}, wanted ${JSON.stringify(want)}`];
}

export const check = (api) => wayIn(api, 'coasys-call-bar-live', 'Join', ['Live', 'Interpretation', 'export']);
