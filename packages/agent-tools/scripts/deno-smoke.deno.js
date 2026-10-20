/* global Deno, performance, atob, TextDecoder, crypto */
// The Deno half of `deno-smoke.ts`: load the bundle, edit two real Template records through
// `toolsets.template`, and exit non-zero if anything a host relies on did not happen. Plain JS,
// because this file runs in Deno and is checked by running it, not by the package's TypeScript
// build.
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
  check(toolsets.template?.appliesTo.includes('Template'), 'offers a toolset for Template records');

  for (const name of names) {
    console.log(name);
    const started = now();
    const record = records[name];
    const request = 'Add a badge saying Smoke to the top of the page';
    const toolset = await toolsets.template.open({ record, request, author: 'did:smoke' });
    const tools = toolset.tools.map((tool) => tool.name);

    check(tools[0] === 'update_schema' && toolset.tools[0].kind === 'edit', 'offers update_schema first, as an edit');
    check(tools.includes('we_reference'), 'offers the reference lookup');
    check(toolset.system.length > 0 && toolset.prompt.includes('Smoke'), 'says what was asked');
    if (name === 'workshop')
      check(tools.includes('we_template'), 'sends a large template as an outline, with a lookup');

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
