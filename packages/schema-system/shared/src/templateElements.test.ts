import { describe, expect, it } from 'vitest';

import { isTemplateElement, refusedProp } from './templateElements';

describe('native elements a template may mount', () => {
  it('admits what displays, groups or takes input', () => {
    for (const tag of ['div', 'img', 'a', 'details', 'input', 'table', 'video'])
      expect(isTemplateElement(tag)).toBe(true);
  });

  it('refuses what runs, loads into the page, or makes a document of its own', () => {
    for (const tag of ['script', 'style', 'link', 'meta', 'base', 'iframe', 'object', 'embed', 'template', 'svg']) {
      expect(isTemplateElement(tag), tag).toBe(false);
    }
  });
});

describe('props a template may hand an element', () => {
  it('refuses a script URL, however it is cased or padded', () => {
    expect(refusedProp('href', 'javascript:alert(1)', true)).toBeTruthy();
    expect(refusedProp('href', '  JavaScript:alert(1)', true)).toBeTruthy();
    expect(refusedProp('src', 'vbscript:x', false)).toBeTruthy();
    expect(refusedProp('formAction', 'javascript:x', false)).toBeTruthy();
  });

  it('admits a data URL only for media', () => {
    expect(refusedProp('src', 'data:image/png;base64,AAAA', true)).toBeNull();
    expect(refusedProp('src', 'data:video/mp4;base64,AAAA', true)).toBeNull();
    expect(refusedProp('src', 'data:text/html,<script>x</script>', true)).toBeTruthy();
    expect(refusedProp('href', 'data:text/html,x', true)).toBeTruthy();
  });

  it('leaves ordinary URLs and non-URL props alone', () => {
    expect(refusedProp('href', 'https://example.org/page', true)).toBeNull();
    expect(refusedProp('href', '/space/abc', true)).toBeNull();
    // Not a URL prop, so a value that happens to start with a scheme is just text.
    expect(refusedProp('label', 'javascript: the good parts', true)).toBeNull();
  });

  it('refuses an inline document on anything', () => {
    expect(refusedProp('srcdoc', '<p>hi</p>', false)).toBeTruthy();
  });

  it('refuses a string handler on a native element, and leaves a component prop of that shape alone', () => {
    expect(refusedProp('onerror', 'alert(1)', true)).toBeTruthy();
    expect(refusedProp('once', 'yes', false)).toBeNull();
    expect(refusedProp('only', 'did:abc', false)).toBeNull();
  });
});
