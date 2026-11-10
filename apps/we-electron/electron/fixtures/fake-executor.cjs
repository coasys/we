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
const fs = require('fs');
const http = require('http');
const path = require('path');

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
  // A taken port is exit 80, as for the executor (`BindFailed`).
  server.on('error', (err) => {
    process.stderr.write(`fake executor: cannot listen on ${port}: ${err.code}\n`);
    log('exit 80');
    process.exit(80);
  });
  server.listen(port, '127.0.0.1', () => log('ready'));
};

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
