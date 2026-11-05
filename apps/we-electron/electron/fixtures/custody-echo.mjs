#!/usr/bin/env node
// A stand-in for the `we-custody` sidecar in `custodySidecar.test.js`: answers each request with
// what it was started with, and exits when its stdin closes, as the real one does.
import { createInterface } from 'readline';

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method } = JSON.parse(line);
  if (method === 'fail') {
    process.stdout.write(`${JSON.stringify({ id, error: 'it failed' })}\n`);
    return;
  }
  const result = { method, argv: process.argv.slice(2), credential: process.env.AD4M_ADMIN_CREDENTIAL ?? null };
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
});
