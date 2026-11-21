import { describe, expect, it, vi } from 'vitest';

import { appLink } from './o.ts';

describe('/o', () => {
  it('hands the whole offer to coasys://link and nothing else', () => {
    expect(appLink('?a=1', '#offer-token')).toBe('coasys://link?a=1#offer-token');
    expect(appLink('', '#only-fragment')).toBe('coasys://link#only-fragment');
  });

  it('navigates to coasys://link, shows no offer, and sends it nowhere', async () => {
    const replace = vi.fn();
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    vi.stubGlobal('location', { search: '?x=1', hash: '#secret-offer', replace });
    document.body.innerHTML = '<main id="app"></main>';
    vi.resetModules();
    await import('./o.ts');
    expect(replace).toHaveBeenCalledExactlyOnceWith('coasys://link?x=1#secret-offer');
    expect(document.body.textContent).not.toContain('secret-offer');
    expect(send).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
