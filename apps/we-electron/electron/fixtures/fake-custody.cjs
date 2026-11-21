// A stand-in for `we-custody` beside the fake executor, for the supervisor's main agent
// (`mainAgent.js`).
//
// `wallet-passphrase read|make --data-folder <dir>` answers from a keyring that is a JSON file,
// `$FAKE_KEYRING`: `{ "state": "open" | "locked" | "absent", "items": { <folder>: <passphrase> } }`,
// as the real one answers (`crates/custody/src/wallet.rs`): `{passphrase}`, `{none: true}`, or
// `{refused}`: `locked`, or `unavailable` for no keyring at all (`absent`). A read the locked keyring
// refuses says `kept: true` where an item is kept for the folder all the same, as custody does. A make
// on an open keyring with nothing kept keeps a new passphrase. Each ask is a line in
// `$FAKE_KEYRING.log`: `<mode> <state>`.
//
// `storage-secret read|make --data-folder <dir>` answers the executor's storage secret from the same
// file's `storage` items (`crates/custody/src/storage_secret.rs`): `{secret}` (64 hex), `{none: true}`,
// or `{refused}` as above. `storage-secret derive --keyring-id <32 hex> [--new]` reads
// `{passphrase, confirm?}` from stdin and answers a secret that is the SHA-256 of the two (the real one
// is Argon2id), or with `--new`, `{refused: "passphrase"}` for one under 15 characters or a confirm that
// differs. Each is a line in `$FAKE_KEYRING.storage.log`: `<mode> <state>`, `derive`.
//
// Without `$FAKE_KEYRING` the file is `<folder>/fake-custody.keyring.json`, open.
//
// Otherwise it is the sidecar: it reads stdin until it closes, and exits 0.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args[0] === 'storage-secret') {
  const [, mode, flag, value, extra] = args;
  const keyringOf = (file) =>
    file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { state: 'open', items: {} };
  if (mode === 'derive') {
    if (flag !== '--keyring-id' || !/^[0-9a-f]{32}$/.test(value ?? '')) process.exit(2);
    const file = process.env.FAKE_KEYRING;
    if (file) fs.appendFileSync(`${file}.storage.log`, 'derive\n');
    let input = '';
    process.stdin.on('data', (chunk) => (input += chunk.toString('utf8')));
    process.stdin.on('end', () => {
      const { passphrase = '', confirm } = JSON.parse(input.split('\n')[0] || '{}');
      let answer;
      if (extra === '--new' && [...passphrase].length < 15)
        answer = { refused: 'passphrase', reason: 'Use at least 15 characters. Spaces count.' };
      else if (extra === '--new' && confirm !== passphrase)
        answer = { refused: 'passphrase', reason: 'The two passphrases differ.' };
      else if (!passphrase) answer = { refused: 'passphrase', reason: 'Type the passphrase.' };
      else answer = { secret: crypto.createHash('sha256').update(`${value}:${passphrase}`).digest('hex') };
      process.stdout.write(`${JSON.stringify(answer)}\n`);
      process.exit(0);
    });
    return;
  }
  if (!['read', 'make'].includes(mode) || flag !== '--data-folder' || !value) process.exit(2);
  const file = process.env.FAKE_KEYRING ?? path.join(value, 'fake-custody.keyring.json');
  const keyring = keyringOf(file);
  keyring.storage ??= {};
  if (process.env.FAKE_KEYRING) fs.appendFileSync(`${file}.storage.log`, `${mode} ${keyring.state}\n`);
  let answer;
  if (keyring.state === 'locked') answer = { refused: 'locked' };
  else if (keyring.state === 'absent') answer = { refused: 'unavailable', reason: 'no Secret Service on this bus' };
  else if (keyring.storage[value]) answer = { secret: keyring.storage[value] };
  else if (mode === 'read') answer = { none: true };
  else {
    keyring.storage[value] = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, JSON.stringify(keyring));
    answer = { secret: keyring.storage[value] };
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
  process.exit(0);
}
if (args[0] === 'wallet-passphrase') {
  const [, mode, flag, folder] = args;
  if (!['read', 'make'].includes(mode) || flag !== '--data-folder' || !folder) process.exit(2);
  const file = process.env.FAKE_KEYRING;
  const keyring = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { state: 'open', items: {} };
  keyring.items ??= {};
  fs.appendFileSync(`${file}.log`, `${mode} ${keyring.state}\n`);
  let answer;
  if (keyring.state === 'locked')
    answer = mode === 'read' && keyring.items[folder] ? { refused: 'locked', kept: true } : { refused: 'locked' };
  else if (keyring.state === 'absent') answer = { refused: 'unavailable', reason: 'no Secret Service on this bus' };
  else if (keyring.items[folder]) answer = { passphrase: keyring.items[folder] };
  else if (mode === 'read') answer = { none: true };
  else {
    keyring.items[folder] = crypto.randomBytes(32).toString('base64url');
    fs.writeFileSync(file, JSON.stringify(keyring));
    answer = { passphrase: keyring.items[folder] };
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
  process.exit(0);
}

process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
