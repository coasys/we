import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rewrite } from './codemod-invoke.mjs';

test('rewrites the token wherever it is spelled', () => {
  const input = [
    '{ "onClick": { "$action": "routeStore.navigate", "args": ["/"] } }', // invoke-codemod: keep
    "onClick: { $action: 'modules.call.startCall' },", // invoke-codemod: keep
    'if (typeof token.$action === "string") return token.$action;', // invoke-codemod: keep
  ].join('\n');
  const { text, count } = rewrite(input);
  assert.equal(count, 4);
  assert.equal(
    text,
    [
      '{ "onClick": { "$invoke": "routeStore.navigate", "args": ["/"] } }',
      "onClick: { $invoke: 'modules.call.startCall' },",
      'if (typeof token.$invoke === "string") return token.$invoke;',
    ].join('\n'),
  );
});

test('leaves other words, and lines marked to keep, alone', () => {
  const input = [
    'const { $actions } = registry; const path = `${action}.run`; const action = 1;',
    "message: 'The $action token is now $invoke', // invoke-codemod: keep",
  ].join('\n');
  assert.deepEqual(rewrite(input), { text: input, count: 0 });
});
