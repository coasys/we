// A stand-in for `ad4m-executor` that follows the run contract the app supervises
// (`executorProcess.js`, `EXIT`), as a plan in the data folder tells it to.
//
// `init --data-path <dir>` writes the marker the app looks for and exits 0. `run` reads
// `<data>/fake-executor.plan.json`: `steps[n - 1]` is what the n-th start does — a number exits with
// that code at once; `"serve"` (the default past the plan) answers GET /health on `--port` with 200
// `{"status":"ok"}` as the executor does (anything else is 404), exits 0
// when its stdin closes (`--watch-stdin true`) or on SIGTERM, and with `{ "serve": true, "thenExit":
// <code>, "afterMs": <ms> }` exits that code once up. Every start, ready and exit is a line in
// `<data>/fake-executor.log`: `<n> start port=<p> pid=<pid>`, `<n> ready`, `<n> exit <code>`,
// `<n> stdin closed`. CommonJS, so it runs from any folder when copied beside the test's resources.
//
// With `--custody-channel true` it keeps the executor's custody contract: `AD4M_CUSTODY_CREDENTIAL`
// or `AD4M_CUSTODY_CREDENTIAL_FILE` in its environment exits 78 at once; otherwise it reads the
// custody credential as the first line of stdin before it listens, and exits 78 when stdin closes
// before a non-blank line ends. What it was started with — `argv`, `env` and that line — is written
// to `<data>/fake-executor.start-<n>.json`.
//
// With `ws-lite.cjs` beside it, it also answers the agent calls the supervisor makes on
// `/api/v1/ws?token=<admin credential>` (`mainAgent.js`): `agent.status`, `agent.generate` and
// `agent.unlock`. The agent is `<data>/fake-executor.agent.json` (`{passphrase}`, made by generate),
// locked at every start; a wrong passphrase is an error; `agent.lock` locks it again. Each is a line in
// the log: `<n> agent generated`, `<n> agent unlocked`, `<n> agent unlock refused`, `<n> agent locked`.
// Another credential is refused (401). With `<data>/fake-executor.status-delay` holding a number of
// milliseconds, the next `agent.status` is read when it arrives and answered that much later, and the
// file is removed (`<n> agent status delayed`): an answer that is already old when it lands.
//
// Its storage starts sealed at every start, as the executor's does: until `storage.unlock` is given
// the secret (64 hex) it answers `runtime.storageStatus` and `storage.unlock` and refuses every other
// call 503 `storage-sealed`. The first secret makes `<data>/ad4m/keyring.json` (here, the secret in
// plain JSON: a fake keyring) and opens it; after that only the same secret opens it (403 otherwise;
// 400 for one that is not 64 hex). The status is the executor's shape, with a fixed keyring id; open,
// the database and language storage are encrypted and the links plain. Log lines: `<n> storage
// unlocked`, `<n> storage unlock refused`. A plan step `{ "serve": true, "storage": "open" }` starts
// open, as an executor given its secret otherwise does; `"storage": "open"` on the plan itself opens
// every start.
const fs = require('fs');
const http = require('http');
const path = require('path');

let wsLite = null;
try {
  wsLite = require(path.join(__dirname, 'ws-lite.cjs'));
} catch {
  // No agent API: the tests that need none copy only this file.
}

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

if (args[0] === 'init') {
  const dir = flag('--data-path');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mainnet_seed.seed'), '');
  process.exit(0);
}

const data = flag('--app-data-path');
const port = Number(flag('--port'));
const planFile = path.join(data, 'fake-executor.plan.json');
const logFile = path.join(data, 'fake-executor.log');
const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, 'utf8')) : { steps: [] };
const n = (plan.started = (plan.started ?? 0) + 1);
fs.writeFileSync(planFile, JSON.stringify(plan));
const step = plan.steps[n - 1] ?? 'serve';
const log = (line) => fs.appendFileSync(logFile, `${n} ${line}\n`);

log(`start port=${port} pid=${process.pid}`);
const custodyChannel = flag('--custody-channel') === 'true';
const started = { argv: args, env: process.env, custodyLine: null };
const record = () => fs.writeFileSync(path.join(data, `fake-executor.start-${n}.json`), JSON.stringify(started));
record();

const refuse = (why) => {
  process.stderr.write(`fake executor: ${why}\n`);
  log('exit 78');
  process.exit(78);
};
if (custodyChannel) {
  for (const name of ['AD4M_CUSTODY_CREDENTIAL', 'AD4M_CUSTODY_CREDENTIAL_FILE']) {
    if (process.env[name] !== undefined) refuse(`${name} is set: the custody credential comes only on stdin`);
  }
}

if (typeof step === 'number') {
  process.stderr.write(`fake executor: start ${n} exits ${step}\n`);
  log(`exit ${step}`);
  process.exit(step);
}

const serve = () => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  if (wsLite) server.on('upgrade', agentApi);
  // A taken port is exit 80, as for the executor (`BindFailed`).
  server.on('error', (err) => {
    process.stderr.write(`fake executor: cannot listen on ${port}: ${err.code}\n`);
    log('exit 80');
    process.exit(80);
  });
  server.listen(port, '127.0.0.1', () => log('ready'));
};

const KEYRING_ID = '00112233445566778899aabbccddeeff';
const keyringFile = path.join(data, 'ad4m', 'keyring.json');
let storageOpen = plan.storage === 'open' || !!(step && typeof step === 'object' && step.storage === 'open');
const storageStatus = () => ({
  state: storageOpen ? 'open' : 'sealed',
  encryptedAtRest: false,
  stores: storageOpen ? { database: 'encrypted', languageStorage: 'encrypted', links: 'plain' } : null,
  keyringId: KEYRING_ID,
  secretSource: storageOpen ? 'operator' : null,
  secretOnDataDisk: false,
  rootGeneration: fs.existsSync(keyringFile) ? 1 : 0,
  lastError: null,
});
const unlockStorage = (secret) => {
  if (typeof secret !== 'string' || !/^[0-9a-fA-F]{64}$/.test(secret))
    return { error: { code: 400, message: 'the storage secret is not 64 hex characters' } };
  const created = !fs.existsSync(keyringFile);
  if (created) {
    fs.mkdirSync(path.dirname(keyringFile), { recursive: true });
    fs.writeFileSync(keyringFile, JSON.stringify({ secret: secret.toLowerCase() }));
  } else if (JSON.parse(fs.readFileSync(keyringFile, 'utf8')).secret !== secret.toLowerCase()) {
    return { error: { code: 403, message: 'the storage secret does not open this keyring' } };
  }
  storageOpen = true;
  return { result: { status: storageStatus(), fingerprint: 'fake', created } };
};

const agentFile = path.join(data, 'fake-executor.agent.json');
let unlocked = false;
const agentStatus = () => {
  const made = fs.existsSync(agentFile);
  return { did: made ? 'did:key:z6MkFakeAgent' : null, isInitialized: made, isUnlocked: made && unlocked, error: null };
};

function agentApi(req, socket) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/api/v1/ws' || url.searchParams.get('token') !== process.env.AD4M_ADMIN_CREDENTIAL) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsLite.wsAccept(req.headers['sec-websocket-key'])}\r\n\r\n`,
  );
  const send = (value) => socket.write(wsLite.textFrame(JSON.stringify(value)));
  wsLite.readFrames(socket, (text) => {
    const { id, type, params = {} } = JSON.parse(text);
    const fail = (message, code = 500) => send({ id, error: { code, message } });
    if (type === 'runtime.storageStatus') return send({ id, result: storageStatus() });
    if (type === 'storage.unlock') {
      const answer = unlockStorage(params.secret);
      log(answer.error ? 'storage unlock refused' : 'storage unlocked');
      return send({ id, ...answer });
    }
    if (!storageOpen) return fail('storage-sealed: the storage is sealed until storage.unlock', 503);
    if (type === 'agent.status') {
      const delayFile = path.join(data, 'fake-executor.status-delay');
      if (!fs.existsSync(delayFile)) return send({ id, result: agentStatus() });
      const ms = Number(fs.readFileSync(delayFile, 'utf8'));
      fs.unlinkSync(delayFile);
      const status = agentStatus();
      log('agent status delayed');
      return setTimeout(() => send({ id, result: status }), ms);
    }
    if (type === 'agent.lock') {
      unlocked = false;
      log('agent locked');
      return send({ id, result: agentStatus() });
    }
    if (type === 'agent.generate') {
      // As the executor does: 409, never a new agent over the one there is.
      if (fs.existsSync(agentFile))
        return fail('the agent is already initialised; unlock it with agent.unlock instead', 409);
      fs.writeFileSync(agentFile, JSON.stringify({ passphrase: params.passphrase }));
      unlocked = true;
      log('agent generated');
      return send({ id, result: agentStatus() });
    }
    if (type === 'agent.unlock') {
      if (!fs.existsSync(agentFile)) return fail('Agent not initialized');
      if (JSON.parse(fs.readFileSync(agentFile, 'utf8')).passphrase !== params.passphrase) {
        log('agent unlock refused');
        return fail('Failed to decrypt the agent keys');
      }
      unlocked = true;
      log('agent unlocked');
      return send({ id, result: agentStatus() });
    }
    fail(`unknown method ${type}`);
  });
}

// The custody credential first, as the executor reads it before it starts anything.
let pending = custodyChannel ? '' : null;
if (pending === null) serve();
process.stdin.on('data', (chunk) => {
  if (pending === null) return;
  pending += chunk.toString('utf8');
  const end = pending.indexOf('\n');
  if (end === -1) return;
  const line = pending.slice(0, end).replace(/\r$/, '');
  pending = null;
  if (!line.trim()) refuse('the custody credential line is blank');
  started.custodyLine = line;
  record();
  log('custody credential read');
  serve();
});
process.stdin.on('end', () => {
  if (pending !== null) refuse('stdin closed before the custody credential line');
  log('stdin closed');
  log('exit 0');
  process.exit(0);
});
process.on('SIGTERM', () => {
  log('exit 0');
  process.exit(0);
});

if (step && typeof step === 'object' && step.thenExit !== undefined) {
  setTimeout(() => {
    log(`exit ${step.thenExit}`);
    process.exit(step.thenExit);
  }, step.afterMs ?? 200);
}
