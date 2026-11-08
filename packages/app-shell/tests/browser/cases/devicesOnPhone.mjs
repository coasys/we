/**
 * Settings → Devices on a phone: every badge whole inside its card, and "offered" not a warning.
 *
 * On the phone the row of a device whose master key was sent and not yet taken drew "Master key
 * offered, not yet taken" as a warning badge. Offered is pending, not a problem, and it is a
 * sentence: a badge never wraps its words, so at 320px it ran out of the card and was cut off.
 * It is a muted line in the row's detail now, and what is still a badge must lie whole inside
 * every box that clips it.
 */
export const name = 'the device list on a phone: badges whole, offered is a neutral line';
export const scenario = 'devices:phone';
export const widths = [320, 360, 412];

const OFFERED = 'Master key offered, not yet taken';

export async function check({ evaluate, screenshot }) {
  const problems = [];
  await screenshot('devices-phone');
  const found = await evaluate((offeredWords) => {
    const page = document.getElementById('devices-page');
    const fmt = (r) => `${Math.round(r.left)}–${Math.round(r.right)} × ${Math.round(r.top)}–${Math.round(r.bottom)}`;
    const outside = (box, r) =>
      box.left < r.left - 0.5 || box.right > r.right + 0.5 || box.top < r.top - 0.5 || box.bottom > r.bottom + 0.5;
    // The badge's own drawn box: its shadow part when it has one (the host can be laid out
    // narrower than what it paints), else the host.
    const drawn = (badge) => {
      const host = badge.getBoundingClientRect();
      const base = badge.shadowRoot?.querySelector('[part="base"]')?.getBoundingClientRect();
      if (!base) return host;
      return {
        left: Math.min(host.left, base.left),
        right: Math.max(host.right, base.right, host.left + badge.scrollWidth),
        top: Math.min(host.top, base.top),
        bottom: Math.max(host.bottom, base.bottom),
      };
    };
    const badges = [...page.querySelectorAll('we-badge')].filter((b) => b.getBoundingClientRect().width > 0);
    const viewport = { left: 0, top: -Infinity, right: document.documentElement.clientWidth, bottom: Infinity };
    const results = badges.map((badge) => {
      const box = drawn(badge);
      const clipped = [];
      if (outside(box, viewport)) clipped.push(`the screen 0–${viewport.right}`);
      // Every ancestor that clips, the page included: the badge must lie inside each.
      for (let el = badge.parentElement; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible' || el === page) {
          const r = el.getBoundingClientRect();
          if (outside(box, r)) clipped.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} ${fmt(r)}`);
        }
        if (el === page) break;
      }
      return {
        kind: 'badge',
        text: badge.textContent.trim(),
        tone: badge.getAttribute('tone') ?? badge.tone ?? null,
        box: fmt(box),
        clipped,
      };
    });
    // The offered line: drawn as text, and in a muted colour rather than a warning one.
    const line = [...page.querySelectorAll('we-text')].find((t) => t.textContent.trim() === offeredWords);
    if (line) {
      results.push({
        kind: 'line',
        text: offeredWords,
        color: line.getAttribute('color') ?? line.color ?? null,
        box: fmt(line.getBoundingClientRect()),
        clipped: outside(line.getBoundingClientRect(), page.getBoundingClientRect()) ? ['#devices-page'] : [],
      });
    }
    return results;
  }, OFFERED);
  const offered = found.find((b) => b.text === OFFERED);
  if (!offered) problems.push('the offered state is not drawn');
  else if (offered.kind === 'badge') problems.push(`"offered" is a badge (tone ${offered.tone}), not a line`);
  else if (offered.color !== 'text-muted') problems.push(`the "offered" line is ${offered.color}, not text-muted`);
  const holds = found.find((b) => b.kind === 'badge' && b.text === 'Holds the master key');
  if (!holds) problems.push('no "holds" badge drawn');
  else if (holds.tone !== 'accent') problems.push(`the "holds" badge is tone ${holds.tone}, not accent`);
  for (const item of found) {
    if (item.clipped.length) problems.push(`"${item.text}" (${item.box}) is cut off by ${item.clipped.join('; ')}`);
  }
  return problems;
}
