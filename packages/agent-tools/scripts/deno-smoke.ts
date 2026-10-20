/**
 * Runs the single-file bundle under Deno, against real templates, the way a host would.
 *
 * The bundle's whole promise is that it runs where WE does not: no DOM, no Node, nothing but the
 * file. Vitest runs in Node, so it cannot keep that promise — an import that reaches for `document`
 * or `node:fs` passes every unit test and breaks the first host that loads the file. This is the
 * check that would notice.
 *
 * Node writes the templates out as records (they are TypeScript source, which Deno cannot resolve
 * from the workspace) and Deno runs `deno-smoke.deno.js` with permission to read only those and
 * the bundle.
 *
 * Run: pnpm --filter @we/agent-tools build && pnpm --filter @we/agent-tools test:deno
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeTemplateFile } from '@we/entities';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { kanbanTemplate, workshopTemplate } from '@we/template-showcase';

import { createTemplateToolset } from '../src/templates/templateToolset';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, '../dist/agent-tools.bundle.js');

if (!existsSync(bundle)) {
  console.error(`No bundle at ${bundle}. Build the package first: pnpm --filter @we/agent-tools build`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'agent-tools-smoke-'));
try {
  // Each template as the Template record a host reads: stored with permanent ids, its file
  // resolved to the data URI the app reads it as. Kanban fits the template budget and is sent
  // whole; workshop does not, and goes as an outline.
  const record = async (name: string, template: unknown) => {
    // An untouched toolset's result is the template with the permanent ids a stored one carries.
    const untouched = await createTemplateToolset({ template: template as SchemaNode, request: '' });
    const stored = untouched.result().template as TemplateSchema;
    const file = encodeTemplateFile(stored);
    const properties = { name, version: 1, schema: `data:${file.file_type};base64,${file.data_base64}` };
    writeFileSync(
      join(dir, `${name}.json`),
      JSON.stringify({ id: `${name}-record`, className: 'Template', properties }),
    );
  };
  await record('kanban', kanbanTemplate);
  await record('workshop', workshopTemplate);

  const run = spawnSync(
    'deno',
    ['run', '--no-prompt', `--allow-read=${dir},${bundle}`, join(here, 'deno-smoke.deno.js'), bundle, dir],
    { stdio: 'inherit' },
  );
  if (run.error) {
    console.error(`Could not start deno (${run.error.message}). Install it: https://docs.deno.com/runtime/`);
    process.exit(1);
  }
  process.exit(run.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
