import { describe, expect, it } from 'vitest';

import { parseServerUrl } from './lifecycle';

describe('parseServerUrl', () => {
  it.each([
    ['https://links.example.org', 'https://links.example.org'],
    ['http://localhost:8080/sync', 'http://localhost:8080/sync'],
    ['  https://links.example.org/  ', 'https://links.example.org/'],
  ])('keeps the http(s) address %j, trimmed', (url, expected) => {
    expect(parseServerUrl(url)).toBe(expected);
  });

  it.each([
    '',
    'links.example.org',
    'wss://links.example.org',
    'ftp://links.example.org',
    'javascript:alert(1)',
    'https://',
    'http://[::1',
  ])('refuses %j', (url) => {
    expect(parseServerUrl(url)).toBeNull();
  });
});
