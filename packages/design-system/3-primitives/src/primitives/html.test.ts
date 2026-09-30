/**
 * What `we-html` keeps of an SVG, and what it says when it drops something.
 *
 * The sanitiser's policy is DOMPurify's and is not under test here; what is under test is that the
 * policy stops being *silent*. An author writing SMIL saw a static drawing and no reason for it —
 * it typechecked, it validated, and it rendered nothing wrong, just nothing moving.
 *
 * These run against the installed DOMPurify and the installed jsdom rather than against a stubbed
 * allowlist, so a version bump that changes what survives fails here rather than in a template.
 */
import './html';

import { describe, expect, it, vi } from 'vitest';

interface HtmlEl extends HTMLElement {
  content: string;
  updateComplete: Promise<unknown>;
}

async function mount(content: string) {
  const el = document.createElement('we-html') as HtmlEl;
  el.content = content;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const rendered = (el: HtmlEl) => el.shadowRoot!.querySelector('[part="base"]')!.innerHTML;

describe('we-html and SVG', () => {
  it('keeps a drawing', async () => {
    const el = await mount('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>');
    expect(rendered(el)).toContain('<circle');
  });

  it('keeps animation written as CSS keyframes', async () => {
    // The path the warning points people at, so it had better be true.
    const el = await mount(
      '<svg viewBox="0 0 10 10"><style>@keyframes spin { to { transform: rotate(360deg) } }</style>' +
        '<circle cx="5" cy="5" r="4"></circle></svg>',
    );
    expect(rendered(el)).toContain('@keyframes');
  });

  it('keeps animateMotion', async () => {
    const el = await mount(
      '<svg viewBox="0 0 10 10"><circle r="2"><animateMotion dur="2s" path="M0,0 L10,10"></animateMotion></circle></svg>',
    );
    expect(rendered(el)).toContain('animateMotion');
  });

  it('drops SMIL, and says so', async () => {
    // `<set attributeName="href" to="javascript:…">` is a real XSS vector against an `<a>`, so the
    // exclusion stays. What changes is that the author is told, and told what to write instead.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = await mount('<svg viewBox="0 0 10 10"><circle r="2"><animate attributeName="r" to="4"/></circle></svg>');

    expect(rendered(el)).not.toContain('<animate');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('@keyframes');
    warn.mockRestore();
  });

  it('says it once, however often the element re-renders', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = await mount('<svg><circle r="2"><set attributeName="r" to="4"/></circle></svg>');
    el.content = '<svg><circle r="3"><set attributeName="r" to="5"/></circle></svg>';
    await el.updateComplete;

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('stays quiet about ordinary HTML', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount('<p>Nothing to do with SVG at all.</p>');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
