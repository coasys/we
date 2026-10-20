/* global Deno, performance, atob, TextDecoder */
// The Deno half of `deno-smoke.ts`: load the bundle, edit two real Template records through
// `toolsets.template`, and exit non-zero if anything a host relies on did not happen. Plain JS,
// because this file runs in Deno and is checked by running it, not by the package's TypeScript
// build.
//
// Usage: deno run --allow-read=<dir>,<bundle> deno-smoke.deno.js <bundle> <dir>

const [bundlePath, dir] = Deno.args;
const { toolsets } = await import(`file://${bundlePath}`);

let failures = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
};

const ids = (node, into = new Set()) => {
  if (node && typeof node === 'object') {
    if (typeof node.id === 'string' && typeof node.type === 'string') into.add(node.id);
    for (const value of Object.values(node)) ids(value, into);
  }
  return into;
};

/** The JSON in a data URI or a FileData — read here by hand, the way the app reads it, not by the bundle. */
const readFile = (value) => {
  const base64 = typeof value === 'string' ? value.slice(value.indexOf(';base64,') + 8) : value.data_base64;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};

const badge = { targetId: '', insert: { children: { node: { type: 'we-badge', children: ['Smoke'] } } } };

check(toolsets.template?.appliesTo.includes('Template'), 'offers a toolset for Template records');

for (const name of ['kanban', 'workshop']) {
  console.log(name);
  const started = performance.now();
  const record = JSON.parse(await Deno.readTextFile(`${dir}/${name}.json`));
  const request = 'Add a badge saying Smoke to the top of the page';
  const toolset = await toolsets.template.open({ record, request, author: 'did:smoke' });
  const tools = toolset.tools.map((tool) => tool.name);

  check(tools[0] === 'update_schema' && toolset.tools[0].kind === 'edit', 'offers update_schema first, as an edit');
  check(tools.includes('we_reference'), 'offers the reference lookup');
  check(toolset.system.length > 0 && toolset.prompt.includes('Smoke'), 'says what was asked');
  if (name === 'workshop') check(tools.includes('we_template'), 'sends a large template as an outline, with a lookup');

  const reference = await toolset.call('we_reference', { components: ['we-badge'] });
  check(reference.includes('we-badge'), 'answers a reference lookup');

  const refused = await toolset.call('update_schema', {
    patches: [{ targetId: '', insert: { children: { node: { type: 'we-nonexistent' } } } }],
  });
  check(refused.startsWith('Error: Semantic validation failed'), 'refuses a component that does not exist');
  check(!toolset.result().changed, 'keeps nothing from a refused edit');

  // As a JSON string, the way some providers deliver arguments.
  const kept = await toolset.call('update_schema', JSON.stringify({ patches: [badge] }));
  check(!kept.startsWith('Error'), 'keeps a valid edit');

  const unknown = await toolset.call('no_such_tool', {});
  check(unknown.startsWith('Error: Unknown tool'), 'refuses a tool it does not have');

  const { changed, properties } = toolset.result();
  check(changed, 'reports the edit as a change');
  check(properties.version === 2, 'moves the version on, as a save does');
  check(properties.schema?.name === 'template-schema.json', 'writes the schema as the file the app stores');

  const before = readFile(record.properties.schema).schema;
  const after = readFile(properties.schema).schema;
  const original = ids(before);
  const written = ids(after);
  check(JSON.stringify(after).includes('"Smoke"'), 'the written template holds the badge');
  check(
    original.size > 0 && [...original].every((id) => written.has(id)),
    `every node keeps its id (${original.size})`,
  );
  check(!JSON.stringify(after).includes('"$defs"'), 'is written expanded, as templates are stored');
  check(after.id === before.id && after.author === 'did:smoke', 'keeps its id and records who wrote it');

  console.log(`  ${Math.round(performance.now() - started)} ms`);
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  Deno.exit(1);
}
