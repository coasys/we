#!/usr/bin/env node
// A stand-in for the `we-custody` sidecar in `custodySidecar.test.js`: reads the custody credential
// from the first line of its stdin, as the real one does, then answers each request with what it
// was started with, and exits when its stdin closes.
import { createInterface } from 'readline';

let credential = null;
createInterface({ input: process.stdin }).on('line', (line) => {
  if (credential === null) {
    credential = line;
    return;
  }
  const { id, method } = JSON.parse(line);
  if (method === 'fail') {
    process.stdout.write(`${JSON.stringify({ id, error: 'it failed' })}\n`);
    return;
  }
  const result = {
    method,
    argv: process.argv.slice(2),
    credential,
    envCredential: process.env.AD4M_CUSTODY_CREDENTIAL ?? null,
    admin: process.env.AD4M_ADMIN_CREDENTIAL ?? null,
  };
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
});
