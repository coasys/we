import { resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseRenderArgs, resolveInRoot, UsageError } from './render';

describe('reading the command line', () => {
  it('takes the defaults, and names the output after the template', () => {
    expect(parseRenderArgs(['templates/feed.json'])).toMatchObject({
      templatePath: 'templates/feed.json',
      output: 'feed.png',
      width: 1440,
      height: 900,
      scale: 2,
    });
    expect(parseRenderArgs(['feed.json', '--svg']).output).toBe('feed.svg');
  });

  it('reads every option', () => {
    expect(
      parseRenderArgs([
        'feed.json',
        '-o',
        'out/a.png',
        '--fixture',
        'kanban',
        '--viewport',
        '390x844',
        '--scale',
        '3',
        '--wait',
        '0',
        '--port',
        '4000',
        '--bare',
        '--route',
        '/settings',
        '--full-page',
      ]),
    ).toEqual({
      templatePath: 'feed.json',
      output: 'out/a.png',
      fixture: 'kanban',
      width: 390,
      height: 844,
      scale: 3,
      svg: false,
      wait: 0,
      port: 4000,
      bare: true,
      route: '/settings',
      fullPage: true,
    });
  });

  it('leaves the route unset unless asked, so a fixture keeps its own', () => {
    expect(parseRenderArgs(['feed.json', '--fixture', 'discord']).route).toBeUndefined();
  });

  it.each([
    [['feed.json', '--viewport', '1440'], /WIDTHxHEIGHT/],
    [['feed.json', '--viewport', '0x900'], /WIDTHxHEIGHT/],
    [['feed.json', '--scale', 'two'], /--scale/],
    [['feed.json', '--scale', '0'], /--scale/],
    [['feed.json', '--wait', '-5'], /--wait/],
    [['feed.json', '--port'], /needs a value/],
    [['feed.json', '--route', '--bare'], /needs a value/],
    [['feed.json', '--colour'], /Unknown option/],
    [['feed.json', 'other.json'], /One template/],
    [[], /No template/],
  ])('refuses %j rather than rendering something else', (argv, message) => {
    expect(() => parseRenderArgs(argv)).toThrow(UsageError);
    expect(() => parseRenderArgs(argv)).toThrow(message);
  });
});

describe('finding a file to serve', () => {
  const root = resolve('/srv/preview/dist');

  it('serves what is under the root, decoded', () => {
    expect(resolveInRoot(root, '/assets/index.js')).toBe(`${root}${sep}assets${sep}index.js`);
    expect(resolveInRoot(root, '/fonts/My%20Font.woff2')).toBe(`${root}${sep}fonts${sep}My Font.woff2`);
    expect(resolveInRoot(root, '/')).toBe(root);
  });

  it('refuses anything that leaves it', () => {
    expect(resolveInRoot(root, '/../secret')).toBeNull();
    expect(resolveInRoot(root, '/%2e%2e/secret')).toBeNull();
    expect(resolveInRoot(root, '/..%2f..%2fetc%2fpasswd')).toBeNull();
    // A sibling whose name starts with the root's: what a bare prefix test let through.
    expect(resolveInRoot(root, '/../dist-old/index.html')).toBeNull();
  });

  it('refuses a path that does not decode, or carries a NUL', () => {
    expect(resolveInRoot(root, '/%E0%A4%A')).toBeNull();
    expect(resolveInRoot(root, '/index.html%00.png')).toBeNull();
  });
});
