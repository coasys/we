import { describe, expect, it } from 'vitest';

import { parseServerUrl } from './lifecycle';

describe('parseServerUrl', () => {
  it.each([
    ['https://link.ad4m.dev', 'https://link.ad4m.dev'],
    ['http://localhost:8080/sync', 'http://localhost:8080/sync'],
    ['  https://links.example.org/  ', 'https://links.example.org/'],
  ])('keeps the http(s) address %j, trimmed', (url, expected) => {
    expect(parseServerUrl(url)).toBe(expected);
  });

  it.each([
    '',
    'link.ad4m.dev',
    'wss://link.ad4m.dev',
    'ftp://link.ad4m.dev',
    'javascript:alert(1)',
    'https://',
    'http://[::1',
  ])('refuses %j', (url) => {
    expect(parseServerUrl(url)).toBeNull();
  });
});
