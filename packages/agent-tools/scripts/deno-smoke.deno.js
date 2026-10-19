/* global Deno, performance */
// The Deno half of `deno-smoke.ts`: load the bundle, edit two real templates through the toolset,
// and exit non-zero if anything a host relies on did not happen. Plain JS, because this file runs
// in Deno and is checked by running it, not by the package's TypeScript build.
//
// Usage: deno run --allow-read=<dir>,<bundle> deno-smoke.deno.js <bundle> <dir>

const [bundlePath, dir] = Deno.args;
const { createTemplateToolset } = await import(`file://${bundlePath}`);

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

const badge = { targetId: '', insert: { children: { node: { type: 'we-badge', children: ['Smoke'] } } } };

for (const name of ['kanban', 'workshop']) {
  console.log(name);
  const started = performance.now();
  const authored = JSON.parse(await Deno.readTextFile(`${dir}/${name}.json`));
  const request = 'Add a badge saying Smoke to the top of the page';
  // A stored template carries permanent ids and an authored one does not; an untouched toolset's
  // result is the template with its ids, which is what a host would read out of storage.
  const template = (await createTemplateToolset({ template: authored, request })).result().template;
  const toolset = await createTemplateToolset({ template, request });
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

  const { template: edited, changed, edits } = toolset.result();
  const before = ids(template);
  const after = ids(edited);
  check(changed && edits === 1, 'reports one kept edit');
  check(JSON.stringify(edited).includes('"Smoke"'), 'the edited template holds the badge');
  check(before.size > 0 && [...before].every((id) => after.has(id)), `every node keeps its id (${before.size})`);
  check(!JSON.stringify(edited).includes('"$defs"'), 'comes back expanded, as templates are stored');

  console.log(`  ${Math.round(performance.now() - started)} ms`);
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  Deno.exit(1);
}
