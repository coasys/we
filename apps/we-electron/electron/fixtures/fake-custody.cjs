// A stand-in for `we-custody` beside the fake executor, for the supervisor's main agent
// (`mainAgent.js`).
//
// `wallet-passphrase read|make --data-folder <dir>` answers from a keyring that is a JSON file,
// `$FAKE_KEYRING`: `{ "state": "open" | "locked" | "absent", "items": { <folder>: <passphrase> } }`,
// as the real one answers (`crates/custody/src/wallet.rs`): `{passphrase}`, `{none: true}`, or
// `{refused}`. A make on an open keyring with nothing kept keeps a new passphrase. Each ask is a line
// in `$FAKE_KEYRING.log`: `<mode> <state>`.
//
// Otherwise it is the sidecar: it reads stdin until it closes, and exits 0.
const crypto = require('crypto');
const fs = require('fs');

const args = process.argv.slice(2);
if (args[0] === 'wallet-passphrase') {
  const [, mode, flag, folder] = args;
  if (!['read', 'make'].includes(mode) || flag !== '--data-folder' || !folder) process.exit(2);
  const file = process.env.FAKE_KEYRING;
  const keyring = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { state: 'open', items: {} };
  keyring.items ??= {};
  fs.appendFileSync(`${file}.log`, `${mode} ${keyring.state}\n`);
  let answer;
  if (keyring.state === 'locked') answer = { refused: 'locked' };
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
