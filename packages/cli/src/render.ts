/**
 * The parts of `we-render` that decide things, kept apart from the parts that do them — the server,
 * the browser, the file system — so they can be tested without any of those.
 */
import { basename, extname, resolve, sep } from 'node:path';

export interface RenderArgs {
  /** Absent when a fixture file carries its own templates — a cartridge's shell travels in its fixture. */
  templatePath?: string;
  output: string;
  fixture?: string;
  /** A fixture from a file: content, shapes, records and templates the space should carry. */
  fixtureFile?: string;
  width: number;
  height: number;
  scale: number;
  svg: boolean;
  wait: number;
  port: number;
  bare: boolean;
  /** Absent means the fixture's own route (or, with `--bare`, the template's first). */
  route?: string;
  fullPage: boolean;
}

export const USAGE =
  'Usage: we-render <template.json> [--output file] [--fixture id] [--viewport WxH] [--svg]\n\n' +
  'Renders a WE template JSON to an image using the preview host and Playwright.\n\n' +
  'Options:\n' +
  '  --output, -o <path>   Output file path\n' +
  '  --fixture <id>        Bundled fixture: discord, twitter, instagram, youtube, kanban, events\n' +
  '  --fixture-file <path> A fixture from a file; with no template, renders the template it carries\n' +
  '  --viewport <WxH>      Viewport size (default: 1440x900)\n' +
  '  --scale <n>           Device pixel ratio (default: 2)\n' +
  '  --svg                 SVG output via foreignObject\n' +
  '  --wait <ms>           Wait after boot (default: 1500)\n' +
  '  --port <n>            Local server port (default: auto)\n' +
  '  --bare                Render the template alone, without the app shell\n' +
  "  --route <path>        Route to render (default: the fixture's own; with --bare, the template's first)\n" +
  '  --full-page           Capture the whole scrollable page';

/** A command line that cannot be run. The message is what to tell the person who typed it. */
export class UsageError extends Error {}

/**
 * Read the command line. A value that does not parse is refused rather than passed on: a scale of
 * `NaN` or a viewport silently left at its default renders an image that looks right and is not the
 * one asked for.
 */
export function parseRenderArgs(argv: readonly string[]): RenderArgs {
  const args: Omit<RenderArgs, 'templatePath' | 'output'> & { templatePath?: string; output?: string } = {
    width: 1440,
    height: 900,
    scale: 2,
    svg: false,
    wait: 1500,
    port: 0,
    bare: false,
    fullPage: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = (): string => {
      i += 1;
      const next = argv[i];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      return next;
    };
    const number = (min: number): number => {
      const raw = value();
      const n = Number(raw);
      if (!Number.isFinite(n) || n < min)
        throw new UsageError(`${arg} takes a number of at least ${min}, not "${raw}"`);
      return n;
    };

    if (arg === '--output' || arg === '-o') args.output = value();
    else if (arg === '--fixture') args.fixture = value();
    else if (arg === '--fixture-file') args.fixtureFile = value();
    else if (arg === '--viewport') {
      const raw = value();
      const match = /^(\d+)x(\d+)$/.exec(raw);
      if (!match || +match[1] < 1 || +match[2] < 1) throw new UsageError(`--viewport takes WIDTHxHEIGHT, not "${raw}"`);
      args.width = +match[1];
      args.height = +match[2];
    } else if (arg === '--scale') {
      args.scale = number(0);
      if (args.scale === 0) throw new UsageError('--scale must be more than 0');
    } else if (arg === '--svg') args.svg = true;
    else if (arg === '--png') args.svg = false;
    else if (arg === '--wait') args.wait = number(0);
    else if (arg === '--port') args.port = number(0);
    else if (arg === '--bare') args.bare = true;
    else if (arg === '--route') args.route = value();
    else if (arg === '--full-page') args.fullPage = true;
    else if (arg.startsWith('-')) throw new UsageError(`Unknown option ${arg}`);
    else if (!args.templatePath) args.templatePath = arg;
    else throw new UsageError(`One template at a time — got "${args.templatePath}" and "${arg}"`);
  }

  const source = args.templatePath ?? args.fixtureFile;
  if (!source) throw new UsageError('No template given');
  if (args.fixture && args.fixtureFile) throw new UsageError('--fixture and --fixture-file are one or the other');
  const output = args.output ?? `${basename(source, extname(source))}.${args.svg ? 'svg' : 'png'}`;
  return { ...args, output };
}

/**
 * The file under `root` that a request path names, or null when it names something outside it.
 *
 * Decoded first, since a browser asks for `%20` where the file has a space. The containment check
 * compares against `root` plus a separator: a bare prefix test lets `/dist-old/…` through for a root
 * of `/dist`.
 */
export function resolveInRoot(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = resolve(root);
  const file = resolve(base, `.${decoded.startsWith('/') ? '' : '/'}${decoded}`);
  return file === base || file.startsWith(base + sep) ? file : null;
}
