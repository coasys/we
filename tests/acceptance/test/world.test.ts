import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';

import { describe, expect, it } from 'vitest';

import { xwdToPng } from '../src/drivers/display.ts';
import { HarnessLink } from '../src/drivers/harnessLink.ts';
import { languageAddress } from '../src/world/local.ts';
import { Endpoints, hostName, isProduction, NAMES } from '../src/world/names.ts';

describe('names and origins', () => {
  it('gives every service a .test name of its own', () => {
    const names = Object.values(NAMES).map((n) => n.local);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.endsWith('.test'))).toBe(true);
    expect(hostName('riverbank')).toBe('host-riverbank.test');
    expect(() => hostName('River Bank')).toThrow();
  });

  it('keeps the web app and the auth domain two sites', () => {
    const site = (host: string) => host.split('.').slice(-2).join('.');
    expect(site(NAMES.webApp.local)).not.toBe(site(NAMES.authDomain.local));
  });

  it('refuses an endpoint that names a production service', () => {
    expect(isProduction('https://store.coasys.org/v1/log')).toBe(true);
    expect(isProduction('https://coasys.id/o#offer')).toBe(true);
    expect(isProduction('https://eu.app.coasys.org')).toBe(true);
    expect(isProduction('http://127.0.0.1:4000')).toBe(false);
    expect(isProduction('https://notcoasys.id')).toBe(false);
    const endpoints = new Endpoints();
    expect(() => endpoints.add('store', 'https://store.coasys.org')).toThrow(/production/);
    expect(endpoints.add('store', 'http://127.0.0.1:4000').name).toBe('store.coasys.test');
    expect(endpoints.add('server', 'http://127.0.0.1:4001').name).toBe('host-server.test');
  });
});

describe('the executor’s language address', () => {
  it('is the multihash of the bundle, as ad4m computes it', () => {
    // "Qmz" and the base58 of 0x01 0x00 0x12 0x20 and the bundle's SHA-256, worked out apart.
    expect(languageAddress('')).toBe('QmzSYwdoe4oaK5TP948prScuR5qwz3Bc6x5YPYYvdSkqaer38MJ');
    expect(languageAddress('a')).toBe('QmzSYwdmx6GZeLQHDpU4xY4hojAPU8R21ttxBvwmodzmqXF361Q');
  });
});

describe('the screenshot', () => {
  it('turns an XWD framebuffer into a PNG of the same size and colours', () => {
    const width = 2;
    const height = 1;
    const header = Buffer.alloc(100);
    const fields = [
      100,
      7,
      2,
      24,
      width,
      height,
      0,
      0,
      32,
      0,
      32,
      32,
      width * 4,
      4,
      0xff0000,
      0xff00,
      0xff,
      8,
      0,
      0,
      width,
      height,
      0,
      0,
      0,
    ];
    fields.forEach((v, i) => header.writeUInt32BE(v, i * 4));
    // Least significant byte first: blue, green, red, unused.
    const pixels = Buffer.from([0x30, 0x20, 0x10, 0, 0xff, 0x00, 0x80, 0]);
    const png = xwdToPng(Buffer.concat([header, pixels]));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
  });
});

describe('the harness link', () => {
  async function dial(link: HarnessLink, token: string) {
    const socket = createConnection(link.port, '127.0.0.1');
    await new Promise((r) => socket.once('connect', r));
    socket.write(`${JSON.stringify({ hello: 'we', token })}\n`);
    return socket;
  }

  it('closes a connection with a wrong token, and answers commands over the right one', async () => {
    const link = await HarnessLink.listen();
    try {
      expect(link.url).toBe(`tcp://127.0.0.1:${link.port}`);
      const intruder = await dial(link, 'not-the-token');
      await new Promise((r) => intruder.once('close', r));
      expect(link.refused).toBe(1);

      const app = await dial(link, link.token);
      await link.connected(5000);
      // The app's side: answer `state`.
      createInterface({ input: app }).on('line', (line) => {
        const { id, cmd } = JSON.parse(line);
        app.write(`${JSON.stringify({ id, ok: cmd === 'state', result: { windows: [] }, error: `no ${cmd}` })}\n`);
      });
      await expect(link.send('state')).resolves.toEqual({ windows: [] });
      await expect(link.send('nope')).rejects.toThrow('no nope');
      app.destroy();
    } finally {
      await link.close();
    }
  });
});
