/**
 * The X display the desktop app runs on: an `Xvfb` server started for the run, with its
 * framebuffer in a file (`-fbdir`), so a screenshot is a read of that file and needs no other
 * program.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import { Proc } from '../world/proc.ts';

export class Display {
  private constructor(
    readonly number: number,
    private readonly fbdir: string,
    private readonly proc: Proc,
  ) {}

  /** `:<n>`, for `DISPLAY`. */
  get name(): string {
    return `:${this.number}`;
  }

  /** Starts `Xvfb` on the first free display from :90. */
  static async start(dir: string, logs: string, size = '1440x900'): Promise<Display> {
    const fbdir = join(dir, 'framebuffer');
    mkdirSync(fbdir, { recursive: true });
    for (let n = 90; n < 200; n++) {
      if (existsSync(`/tmp/.X${n}-lock`) || existsSync(`/tmp/.X11-unix/X${n}`)) continue;
      const proc = new Proc(
        `Xvfb :${n}`,
        'Xvfb',
        [`:${n}`, '-screen', '0', `${size}x24`, '-fbdir', fbdir, '-nolisten', 'tcp'],
        {
          log: join(logs, 'xvfb.log'),
        },
      );
      const display = new Display(n, fbdir, proc);
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !proc.exit) {
        if (existsSync(`/tmp/.X11-unix/X${n}`) && existsSync(join(fbdir, 'Xvfb_screen0'))) return display;
        await new Promise((r) => setTimeout(r, 100));
      }
      // Taken by another server, or it did not start: try the next number.
      await proc.stop();
    }
    throw new Error('no free X display between :90 and :199, or Xvfb did not start (see xvfb.log)');
  }

  /** The whole screen, as a PNG. */
  screenshot(): Buffer {
    return xwdToPng(readFileSync(join(this.fbdir, 'Xvfb_screen0')));
  }

  async stop(): Promise<void> {
    await this.proc.stop();
  }
}

/** Converts an XWD image (the format of Xvfb's framebuffer file) of 24 or 32 bits per pixel to a PNG. */
export function xwdToPng(xwd: Buffer): Buffer {
  const field = (i: number) => xwd.readUInt32BE(i * 4);
  const headerSize = field(0);
  const width = field(4);
  const height = field(5);
  const byteOrder = field(7); // 0: least significant byte first
  const bitsPerPixel = field(11);
  const bytesPerLine = field(12);
  const [redMask, greenMask, blueMask] = [field(14), field(15), field(16)];
  const colours = field(19);
  if (bitsPerPixel !== 32 && bitsPerPixel !== 24) throw new Error(`an XWD image of ${bitsPerPixel} bits per pixel`);
  const start = headerSize + colours * 12;
  const bytes = bitsPerPixel / 8;
  const shift = (mask: number) => Math.clz32(mask & -mask) ^ 31;
  const channel = (pixel: number, mask: number) => (((pixel & mask) >>> 0) >>> shift(mask)) & 0xff;

  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = start + y * bytesPerLine;
    const out = y * (width * 3 + 1);
    raw[out] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const at = row + x * bytes;
      let pixel = 0;
      for (let b = 0; b < bytes; b++) {
        const byte = xwd[at + b];
        pixel = byteOrder === 0 ? pixel | (byte << (8 * b)) : (pixel << 8) | byte;
      }
      pixel >>>= 0;
      raw[out + 1 + x * 3] = channel(pixel, redMask);
      raw[out + 2 + x * 3] = channel(pixel, greenMask);
      raw[out + 3 + x * 3] = channel(pixel, blueMask);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, deflate, no filter method, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}
