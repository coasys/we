#!/usr/bin/env node
/**
 * Render a WE template JSON to PNG or SVG.
 *
 * Usage:
 *   we-render <template.json> [options]
 *
 * Options:
 *   --output, -o <path>   Output file (default: <stem>.png or <stem>.svg)
 *   --fixture <id>        Bundled fixture for sample data (discord, twitter, instagram, youtube, kanban, events)
 *   --viewport <WxH>      Viewport dimensions (default: 1440x900)
 *   --scale <n>           Device scale factor (default: 2)
 *   --svg                 Produce SVG via foreignObject instead of PNG
 *   --wait <ms>           Settle time after boot (default: 1500)
 *   --port <n>            Local server port (default: auto)
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SUPPORTED_SCHEMA_VERSION = 1;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.ico': 'image/x-icon',
};

interface RenderArgs {
  templatePath: string;
  output: string;
  fixture?: string;
  width: number;
  height: number;
  scale: number;
  svg: boolean;
  wait: number;
  port: number;
}

function parseArgs(argv: string[]): RenderArgs {
  const args: Partial<RenderArgs> & { width: number; height: number; scale: number; wait: number; port: number } = {
    width: 1440,
    height: 900,
    scale: 2,
    svg: false,
    wait: 1500,
    port: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      i += 1;
      return argv[i];
    };
    if (arg === '--output' || arg === '-o') args.output = next();
    else if (arg === '--fixture') args.fixture = next();
    else if (arg === '--viewport') {
      const [w, h] = next().split('x').map(Number);
      if (w > 0 && h > 0) {
        args.width = w;
        args.height = h;
      }
    } else if (arg === '--scale') args.scale = Number(next());
    else if (arg === '--svg') args.svg = true;
    else if (arg === '--png') args.svg = false;
    else if (arg === '--wait') args.wait = Number(next());
    else if (arg === '--port') args.port = Number(next());
    else if (!arg.startsWith('-') && !args.templatePath) args.templatePath = arg;
  }

  if (!args.templatePath) {
    console.error(
      'Usage: we-render <template.json> [--output file] [--fixture id] [--viewport WxH] [--svg]\n\n' +
        'Renders a WE template JSON to an image using the preview host and Playwright.\n\n' +
        'Options:\n' +
        '  --output, -o <path>   Output file path\n' +
        '  --fixture <id>        Bundled fixture: discord, twitter, instagram, youtube, kanban, events\n' +
        '  --viewport <WxH>      Viewport size (default: 1440x900)\n' +
        '  --scale <n>           Device pixel ratio (default: 2)\n' +
        '  --svg                 SVG output via foreignObject\n' +
        '  --wait <ms>           Wait after boot (default: 1500)',
    );
    process.exit(1);
  }

  if (!args.output) {
    const stem = basename(args.templatePath, extname(args.templatePath));
    args.output = `${stem}.${args.svg ? 'svg' : 'png'}`;
  }

  return args as RenderArgs;
}

function findPreviewDist(): string {
  if (process.env.WE_PREVIEW_DIST) return resolve(process.env.WE_PREVIEW_DIST);
  return resolve(here, '../../../apps/we-preview/dist');
}

async function startServer(
  distDir: string,
  templateJson: string,
  port: number,
): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const indexHtml = await readFile(resolve(distDir, 'index.html'), 'utf-8');

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/__cli_template__') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(templateJson);
      return;
    }

    const filePath = resolve(distDir, pathname.slice(1));
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403);
      res.end();
      return;
    }

    try {
      const s = await stat(filePath);
      if (s.isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
        res.end(await readFile(filePath));
        return;
      }
    } catch {
      // fall through to SPA fallback
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  });

  return new Promise((ok) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      ok({ server, port: addr.port });
    });
  });
}

async function captureSvg(page: import('playwright-core').Page, width: number, height: number): Promise<string> {
  const { styles, html } = await page.evaluate(() => {
    const collected: string[] = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) collected.push(rule.cssText);
      } catch {
        /* cross-origin */
      }
    }
    return { styles: collected.join('\n'), html: document.getElementById('root')?.innerHTML ?? '' };
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    '  <foreignObject width="100%" height="100%">',
    '    <html xmlns="http://www.w3.org/1999/xhtml">',
    `      <head><style type="text/css"><![CDATA[\n${styles}\n]]></style></head>`,
    `      <body>${html}</body>`,
    '    </html>',
    '  </foreignObject>',
    '</svg>',
  ].join('\n');
}

async function render(args: RenderArgs): Promise<void> {
  let chromium: (typeof import('playwright-core'))['chromium'];
  try {
    chromium = (await import('playwright-core')).chromium;
  } catch {
    console.error('playwright-core not found. Install it:\n  pnpm add -D playwright-core');
    process.exit(1);
  }

  const templatePath = resolve(process.cwd(), args.templatePath);
  let templateJson: string;
  try {
    templateJson = await readFile(templatePath, 'utf-8');
  } catch {
    console.error(`Cannot read template: ${templatePath}`);
    process.exit(1);
  }

  let template: Record<string, unknown>;
  try {
    template = JSON.parse(templateJson);
  } catch (e) {
    console.error(`Invalid JSON: ${(e as Error).message}`);
    process.exit(1);
  }

  const version = (template.schemaVersion as number | undefined) ?? SUPPORTED_SCHEMA_VERSION;
  if (version > SUPPORTED_SCHEMA_VERSION) {
    console.error(`Schema version ${version} exceeds supported version ${SUPPORTED_SCHEMA_VERSION}. Update @we/cli.`);
    process.exit(1);
  }

  if (!template.id) template.id = 'cli-external';
  templateJson = JSON.stringify(template);

  const distDir = findPreviewDist();
  try {
    await stat(resolve(distDir, 'index.html'));
  } catch {
    console.error(`Preview host not built at ${distDir}\nRun: pnpm --filter @we/app-preview build`);
    process.exit(1);
  }

  const { server, port } = await startServer(distDir, templateJson, args.port);
  const base = `http://127.0.0.1:${port}`;

  try {
    const browser = await chromium.launch({ channel: 'chrome' });

    try {
      const page = await browser.newPage({
        viewport: { width: args.width, height: args.height },
        deviceScaleFactor: args.scale,
      });

      const problems: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

      const params = new URLSearchParams({ templateUrl: `${base}/__cli_template__`, route: '/' });
      if (args.fixture) params.set('fixture', args.fixture);

      await page.goto(`${base}/?${params}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__wePreview !== undefined, {
        timeout: 30_000,
      });
      await page.waitForTimeout(args.wait);

      const info: Record<string, unknown> | null = await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__wePreview as Record<string, unknown> | null,
      );

      const outputPath = resolve(process.cwd(), args.output);
      await mkdir(dirname(outputPath), { recursive: true });

      if (args.svg) {
        await writeFile(outputPath, await captureSvg(page, args.width, args.height), 'utf-8');
      } else {
        await page.screenshot({ path: outputPath });
      }

      console.log(`\ntemplate  ${template.id}`);
      console.log(`fixture   ${args.fixture ?? '(default)'}`);
      console.log(`viewport  ${args.width}x${args.height} @${args.scale}x`);
      console.log(`output    ${outputPath}`);
      if (info?.path) console.log(`route     ${info.path}`);
      if (problems.length) {
        console.log('\nproblems:');
        for (const p of [...new Set(problems)].slice(0, 15)) console.log(`  ${p.slice(0, 160)}`);
      }

      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    server.close();
  }
}

await render(parseArgs(process.argv.slice(2)));
