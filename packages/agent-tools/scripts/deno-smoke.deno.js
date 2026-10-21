/* global Deno, performance, atob, TextDecoder, crypto */
// The Deno half of `deno-smoke.ts`: load the bundle, read and edit two real Template records
// through `toolsets.template` the way a host calls it, and exit non-zero if anything a host relies
// on did not happen. Plain JS, because this file runs in Deno and is checked by running it, not by
// the package's TypeScript build.
//
// Usage: deno run --allow-read=<dir>,<bundle> deno-smoke.deno.js <bundle> <dir>

/**
 * Everything the bundle may find on `globalThis` beyond the language itself — the whole of what a
 * host has to provide, and listed in the README under "What a host provides". Deno offers far
 * more (fetch, timers, crypto, URL, Deno itself), and a host built to run untrusted bundles offers
 * as little as it can. So everything else is removed before the bundle loads, and a bundle that
 * reaches for any of it fails here, on the PR that started using it, rather than in a host.
 */
const HOST_GLOBALS = ['structuredClone', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'console', 'crypto'];

/** Of `crypto`, only this: random bytes for new node ids. Nothing that signs, hashes or holds a key. */
const CRYPTO_MEMBERS = ['getRandomValues'];

/** What a JavaScript engine provides with no host at all: ECMAScript's globals, and ECMA-402's `Intl`. */
const LANGUAGE_GLOBALS = [
  'globalThis',
  'Infinity',
  'NaN',
  'undefined',
  'eval',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'unescape',
  'AggregateError',
  'Array',
  'ArrayBuffer',
  'AsyncDisposableStack',
  'Atomics',
  'BigInt',
  'BigInt64Array',
  'BigUint64Array',
  'Boolean',
  'DataView',
  'Date',
  'DisposableStack',
  'Error',
  'EvalError',
  'FinalizationRegistry',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'Function',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Intl',
  'Iterator',
  'JSON',
  'Map',
  'Math',
  'Number',
  'Object',
  'Promise',
  'Proxy',
  'RangeError',
  'ReferenceError',
  'Reflect',
  'RegExp',
  'Set',
  'SharedArrayBuffer',
  'String',
  'SuppressedError',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'WeakMap',
  'WeakRef',
  'WeakSet',
];

// What this script needs from Deno, taken before Deno is removed. The records are read up front for
// the same reason.
const host = Deno;
const now = performance.now.bind(performance);
const fullCrypto = crypto;
const [bundlePath, dir] = host.args;
const names = ['kanban', 'workshop'];
const records = {};
for (const name of names) records[name] = JSON.parse(await host.readTextFile(`${dir}/${name}.json`));

const allowed = new Set([...LANGUAGE_GLOBALS, ...HOST_GLOBALS]);
const removed = [];
for (const key of Object.getOwnPropertyNames(globalThis)) {
  if (allowed.has(key) && key !== 'crypto') continue; // crypto is replaced below, by a narrower one
  if (!delete globalThis[key]) throw new Error(`Could not remove ${key} from globalThis`);
  removed.push(key);
}
globalThis.crypto = Object.fromEntries(CRYPTO_MEMBERS.map((member) => [member, fullCrypto[member].bind(fullCrypto)]));
console.log(
  `Bundle sees the language, ${HOST_GLOBALS.join(', ')} (crypto: ${CRYPTO_MEMBERS.join(', ')} only); ${removed.length - 1} other globals removed.`,
);

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

try {
  const { toolsets } = await import(`file://${bundlePath}`);
  const toolset = toolsets.template;
  check(toolset?.appliesTo.includes('Template'), 'offers tools for Template records');
  check(
    toolset.tools.map((tool) => `${tool.name}:${tool.writes}`).join(' ') === 'template_read:false template_update:true',
    'offers template_read, which writes nothing, and template_update, which writes',
  );

  const topics = await toolset.docs.list();
  const start = await toolset.docs.read('template');
  check(
    topics[0]?.path === 'template' && start.includes('template_update'),
    'documents the tools, starting from `template`',
  );
  check((await toolset.docs.read('template/components/we-badge'))?.includes('we-badge'), 'answers a component topic');

  for (const name of names) {
    console.log(name);
    const started = now();
    const record = records[name];
    const call = (tool, args) => toolset.call(tool, { record, args, author: 'did:smoke' });

    const first = (await call('template_read', {})).text;
    const read = JSON.parse(first);
    check(read.version === 1 && read.currentSchema, 'reads the template with its version');
    check(first === (await call('template_read', {})).text, 'reads the same ids twice');
    if (name === 'workshop')
      check(typeof read.currentSchema.outline === 'string', 'sends a large template as an outline');

    const found = (await call('template_read', { find: 'we-' })).text;
    check(found.startsWith('Template version 1.') && /n\d+ we-/.test(found), 'finds nodes by what they are');

    const refused = await call('template_update', {
      version: 1,
      patches: [{ targetId: '', insert: { children: { node: { type: 'we-nonexistent' } } } }],
    });
    check(
      refused.text.startsWith('Error: Semantic validation failed') && !refused.properties,
      'refuses a component that does not exist, and writes nothing',
    );

    const stale = await call('template_update', { version: 0, patches: [badge] });
    check(
      stale.text.startsWith('Error: The template has changed') && !stale.properties,
      'refuses patches written against another version',
    );

    const dry = await call('template_update', { version: 1, patches: [badge], dry_run: true });
    check(dry.text.startsWith('Valid') && !dry.properties, 'checks a dry run and writes nothing');

    // As a JSON string, the way some providers deliver arguments.
    const kept = await call('template_update', JSON.stringify({ version: 1, patches: [badge] }));
    check(kept.text.startsWith('Saved as version 2.'), 'saves a valid edit');

    const unknown = await call('no_such_tool', {});
    check(unknown.text.startsWith('Error: Unknown tool'), 'refuses a tool it does not have');

    const { properties } = kept;
    check(properties?.version === 2, 'moves the version on, as a save does');
    check(properties?.schema?.name === 'template-schema.json', 'writes the schema as the file the app stores');

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

    console.log(`  ${Math.round(now() - started)} ms`);
  }
} catch (error) {
  // A ReferenceError here is almost always the bundle reaching for a global a host does not provide.
  if (error instanceof ReferenceError)
    console.error(`The bundle used something a host does not provide: ${error.message}. See HOST_GLOBALS.`);
  throw error;
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  host.exit(1);
}
