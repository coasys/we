#!/usr/bin/env node
/**
 * The comparison for the phone's numbers: the same 200 `agent.status` calls the diagnostic page
 * makes, over a plain WebSocket from this machine straight to the executor.
 *
 *   node scripts/host-baseline.mjs ws://127.0.0.1:12600 <token> [n]
 */
const [base, token = '', n = '200'] = process.argv.slice(2);
if (!base) {
  console.error('usage: host-baseline.mjs ws://127.0.0.1:<port> <token> [n]');
  process.exit(2);
}
const url = `${base.replace(/\/+$/, '')}/api/v1/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
const count = Number(n);

const t0 = performance.now();
const ws = new WebSocket(url);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const connectMs = performance.now() - t0;
const waiting = new Map();
ws.onmessage = (e) => {
  const id = String(JSON.parse(String(e.data)).id);
  waiting.get(id)?.();
  waiting.delete(id);
};
const times = [];
const started = performance.now();
for (let i = 1; i <= count; i++) {
  const t = performance.now();
  await new Promise((resolve) => {
    waiting.set(String(i), resolve);
    ws.send(JSON.stringify({ id: String(i), type: 'agent.status', params: {} }));
  });
  times.push(performance.now() - t);
}
const elapsed = performance.now() - started;
ws.close();
times.sort((a, b) => a - b);
const at = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
console.log(
  JSON.stringify({
    n: count,
    p50: +at(0.5).toFixed(3),
    p95: +at(0.95).toFixed(3),
    max: +times[times.length - 1].toFixed(3),
    perSecond: Math.round((count * 1000) / elapsed),
    connectMs: +connectMs.toFixed(1),
  }),
);
