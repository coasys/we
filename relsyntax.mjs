import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/james/Desktop/Coding/we/apps/we-preview/')('playwright-core');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://localhost:3100/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
const out = await page.evaluate(() => {
  const r = {};
  r.supported = CSS.supports('color', 'oklch(from red calc(l + 0.1) c h)');
  const d = document.createElement('div');
  document.body.appendChild(d);
  // Does it resolve through a chain of custom properties, which is how a role is actually written?
  d.style.setProperty('--hue', '220');
  d.style.setProperty('--sat', '20%');
  d.style.setProperty('--base', 'hsl(var(--hue) var(--sat) 10%)');
  d.style.setProperty('--derived', 'oklch(from var(--base) calc(l + 0.045) c h)');
  d.style.background = 'var(--derived)';
  r.throughVarChain = getComputedStyle(d).backgroundColor;
  d.style.background = 'var(--base)';
  r.base = getComputedStyle(d).backgroundColor;
  // And does it follow when the chain underneath it changes — the whole point of a role.
  d.style.setProperty('--sat', '60%');
  d.style.background = 'var(--derived)';
  r.afterSaturationChange = getComputedStyle(d).backgroundColor;
  d.remove();
  return r;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
