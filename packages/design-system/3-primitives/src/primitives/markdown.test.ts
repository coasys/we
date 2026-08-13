/**
 * `we-markdown` renders a string somebody else wrote.
 *
 * Markdown is not a safe subset of HTML — it is a superset of it. Every implementation passes raw
 * tags through by design, which is a feature when the author is you and a hole when the author is
 * whoever wrote the post, bio or space description that is being rendered. `we-markdown` is used in
 * exactly those places, and its output goes through `unsafeHTML`.
 *
 * Driven through the element rather than through `marked` + DOMPurify separately, because the thing
 * that must hold is a property of the element: everything it renders has been sanitised. A test of
 * the two libraries in isolation still passes on the day somebody adds a second render path.
 */
import './markdown';

import { beforeEach, describe, expect, it } from 'vitest';

type MarkdownEl = HTMLElement & { content: string; updateComplete: Promise<unknown> };

let el: MarkdownEl;

async function render(content: string) {
  el.content = content;
  await el.updateComplete;
  return el.shadowRoot!.querySelector('[part="base"]')!;
}

beforeEach(async () => {
  document.body.innerHTML = '';
  el = document.createElement('we-markdown') as MarkdownEl;
  document.body.appendChild(el);
  await el.updateComplete;
});

describe('raw HTML inside markdown', () => {
  it('strips a script tag', async () => {
    const base = await render('Hello\n\n<script>window.__pwned = true</script>');

    expect(base.querySelector('script')).toBeNull();
    expect(base.textContent).toContain('Hello');
  });

  it('strips an inline event handler, keeping the element', async () => {
    // The payload that needs no script tag at all, and the one a naive tag blocklist misses.
    const base = await render('<img src="x" onerror="window.__pwned = true" alt="a">');
    const img = base.querySelector('img');

    expect(img?.getAttribute('onerror')).toBeNull();
    expect(img?.getAttribute('alt')).toBe('a');
  });

  it('strips a javascript: href written as a markdown link', async () => {
    const base = await render('[click me](javascript:window.__pwned = true)');
    const link = base.querySelector('a');

    // The link survives as text either way; what must not survive is somewhere to go.
    expect(link?.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
    expect(base.textContent).toContain('click me');
  });

  it('strips an svg/onload payload', async () => {
    const base = await render('<svg onload="window.__pwned = true"></svg>');
    expect(base.querySelector('svg')?.getAttribute('onload')).toBeNull();
  });
});

describe('the markdown it is there to render', () => {
  it('still renders ordinary markdown', async () => {
    const base = await render('# Title\n\nSome **bold** text and a [link](https://we.example).');

    expect(base.querySelector('h1')?.textContent).toBe('Title');
    expect(base.querySelector('strong')?.textContent).toBe('bold');
    expect(base.querySelector('a')?.getAttribute('href')).toBe('https://we.example');
  });

  it('still renders benign inline HTML, which is half of why markdown is used', async () => {
    const base = await render('Some <em>emphasis</em> and a <br> break.');

    expect(base.querySelector('em')?.textContent).toBe('emphasis');
    expect(base.querySelector('br')).not.toBeNull();
  });
});
