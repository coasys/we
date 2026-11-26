import { describe, expect, it } from 'vitest';

import { findUrls, isUrl, withFoundLinks } from './links';

const hrefs = (text: string) => findUrls(text).map((u) => u.href);
const spans = (text: string) => findUrls(text).map((u) => text.slice(u.start, u.end));

describe('findUrls', () => {
  it('stops before the full stop that ends the sentence', () => {
    const text = 'The review is up: https://github.com/coasys/ad4m/pull/1861#pullrequestreview-6006889289. The verdict';
    expect(hrefs(text)).toEqual(['https://github.com/coasys/ad4m/pull/1861#pullrequestreview-6006889289']);
  });

  it('gives back a bracket the URL did not open, and keeps one it did', () => {
    expect(spans('(see https://example.org/a)')).toEqual(['https://example.org/a']);
    expect(spans('see https://en.wikipedia.org/wiki/Set_(mathematics).')).toEqual([
      'https://en.wikipedia.org/wiki/Set_(mathematics)',
    ]);
    expect(spans('(https://en.wikipedia.org/wiki/Set_(mathematics))')).toEqual([
      'https://en.wikipedia.org/wiki/Set_(mathematics)',
    ]);
  });

  it('drops the run of punctuation after a URL, not only the last mark', () => {
    expect(spans('Is it https://example.org/x?!')).toEqual(['https://example.org/x']);
    expect(spans('**https://example.org/bold**')).toEqual(['https://example.org/bold']);
  });

  it('keeps a query and a fragment', () => {
    expect(spans('at https://example.org/a?b=1&c=2#d, then')).toEqual(['https://example.org/a?b=1&c=2#d']);
  });

  it('gives www. its scheme', () => {
    expect(hrefs('go to www.example.org now')).toEqual(['https://www.example.org']);
  });

  it('finds every URL, and none inside a word or with nothing after the scheme', () => {
    expect(spans('a https://one.org and http://two.org/x')).toEqual(['https://one.org', 'http://two.org/x']);
    expect(findUrls('xhttps://nope.org')).toEqual([]);
    expect(findUrls('the scheme is https:// on its own')).toEqual([]);
    expect(findUrls('nothing here, just ad4m#1861 and tests/js/helpers/sfu/renegotiation.ts:73')).toEqual([]);
  });

  it('ends at a quote or an angle bracket', () => {
    expect(spans('"https://example.org/q" and <https://example.org/a>')).toEqual([
      'https://example.org/q',
      'https://example.org/a',
    ]);
  });
});

describe('isUrl', () => {
  it('is a URL and nothing else', () => {
    expect(isUrl('  https://example.org/a  ')).toBe(true);
    expect(isUrl('www.example.org')).toBe(true);
    expect(isUrl('https://example.org/a and more')).toBe(false);
    expect(isUrl('https://example.org/a.')).toBe(false);
  });
});

describe('withFoundLinks', () => {
  it('links a bare URL, counting in code points', () => {
    const text = '🙂 see https://example.org/a.';
    const [link] = withFoundLinks(text, []);
    // The emoji is one code point and two UTF-16 units: "see" starts at code point 2.
    expect(link).toEqual({ start: 6, end: 27, type: 'link', href: 'https://example.org/a' });
    expect(Array.from(text).slice(link.start, link.end).join('')).toBe('https://example.org/a');
  });

  it('leaves what the writer marked as it is', () => {
    const text = 'up: https://example.org/a and `https://example.org/b`';
    const own = { start: 4, end: 25, type: 'link', href: 'https://elsewhere.org' };
    const code = { start: 30, end: 53, type: 'code' };
    expect(withFoundLinks(text, [own, code])).toEqual([own, code]);
  });

  it('answers the same marks when there is nothing to add', () => {
    const marks = [{ start: 0, end: 4, type: 'mention', did: 'did:hex' }];
    expect(withFoundLinks('@Hex hello', marks)).toBe(marks);
    expect(withFoundLinks('@Hex https://x.org', [{ start: 0, end: 18, type: 'code' }])).toHaveLength(1);
  });

  it('adds beside a mention, in order', () => {
    const marks = [{ start: 0, end: 5, type: 'mention', did: 'did:data' }];
    const out = withFoundLinks('@Data see https://example.org', marks);
    expect(out.map((m) => m.type)).toEqual(['mention', 'link']);
  });
});
