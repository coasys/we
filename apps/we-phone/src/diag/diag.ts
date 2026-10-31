/**
 * The pairing screen, and the spike's measuring instrument.
 *
 * Everything here goes through `PinnedWebSocket`, the same adapter WE's executor client uses once
 * paired, so a number measured here is the number WE gets. The functions are also on
 * `window.coasysDiag`, so a test can drive them over the WebView's DevTools protocol.
 */
import { CoasysTransport, PinnedWebSocket } from '@coasys/capacitor-transport';

import { clearPairing, parsePairing, readPairing, type StoredPairing, writePairing } from '../pairing';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (line: string) => {
  $('log').textContent += `${line}\n`;
};

/** The executor's socket path, with the token when there is one. Echo endpoints ignore both. */
function rpcUrl(p: StoredPairing): string {
  const base = p.url.replace(/\/+$/, '');
  return `${base}/api/v1/ws${p.token ? `?token=${encodeURIComponent(p.token)}` : ''}`;
}

export interface OpenResult {
  ok: boolean;
  kind?: string;
  message?: string;
  ms: number;
  socket?: PinnedWebSocket;
}

/** Opens one connection and reports how it went: open, or the error kind it ended with. */
export function open(url: string, pin: string, timeoutMs = 15000): Promise<OpenResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = new PinnedWebSocket(url, pin);
    let error: { kind?: string; message?: string } = {};
    const timer = setTimeout(() => resolve({ ok: false, kind: 'timeout', ms: performance.now() - started }), timeoutMs);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve({ ok: true, ms: performance.now() - started, socket });
    };
    socket.onerror = (e) => {
      error = { kind: (e as Event & { kind?: string }).kind, message: (e as Event & { message?: string }).message };
    };
    socket.onclose = (e) => {
      clearTimeout(timer);
      resolve({ ok: false, ...error, message: error.message ?? e.reason, ms: performance.now() - started });
    };
  });
}

export interface RoundTrips {
  n: number;
  firstReply: unknown;
  p50: number;
  p95: number;
  max: number;
  perSecond: number;
  connectMs: number;
}

/**
 * `n` sequential `agent.status` calls — read-only — each waiting for its reply. Against an echo
 * endpoint the reply is the request itself, which carries the same id, so the same code measures
 * both.
 */
export async function roundTrips(p: StoredPairing, n = 200): Promise<RoundTrips> {
  const opened = await open(rpcUrl(p), p.pin);
  if (!opened.ok || !opened.socket) throw new Error(`${opened.kind}: ${opened.message}`);
  const socket = opened.socket;
  const waiting = new Map<string, (data: string) => void>();
  socket.onmessage = (e) => {
    const data = String(e.data);
    try {
      const id = String((JSON.parse(data) as { id?: unknown }).id);
      waiting.get(id)?.(data);
      waiting.delete(id);
    } catch {
      // Not a reply (a pong, a subscription event): not ours to count.
    }
  };
  const call = (id: number) =>
    new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${id} within 10 s`)), 10000);
      waiting.set(String(id), (data) => {
        clearTimeout(timer);
        resolve(data);
      });
      socket.send(JSON.stringify({ id: String(id), type: 'agent.status', params: {} }));
    });

  const times: number[] = [];
  let firstReply: unknown = null;
  const started = performance.now();
  for (let i = 1; i <= n; i++) {
    const t = performance.now();
    const reply = await call(i);
    times.push(performance.now() - t);
    if (i === 1) firstReply = JSON.parse(reply);
  }
  const elapsed = performance.now() - started;
  socket.close();
  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  return {
    n,
    firstReply,
    p50: at(0.5),
    p95: at(0.95),
    max: times[times.length - 1],
    perSecond: (n * 1000) / elapsed,
    connectMs: opened.ms,
  };
}

function current(): StoredPairing | null {
  const url = $<HTMLInputElement>('url').value.trim();
  const pin = $<HTMLInputElement>('pin').value.trim();
  const token = $<HTMLInputElement>('token').value.trim();
  if (!url || !pin) return null;
  return { url, pin, ...(token ? { token } : {}) };
}

function fill(p: StoredPairing): void {
  $<HTMLInputElement>('url').value = p.url;
  $<HTMLInputElement>('pin').value = p.pin;
  $<HTMLInputElement>('token').value = p.token ?? '';
}

$<HTMLTextAreaElement>('pairing').addEventListener('input', (e) => {
  const p = parsePairing((e.target as HTMLTextAreaElement).value);
  if (p) fill(p);
});

$('scan').addEventListener('click', async () => {
  try {
    const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner');
    const result = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE });
    const p = parsePairing(result.ScanResult);
    if (p) fill(p);
    else log(`The QR code is not a pairing: ${result.ScanResult}`);
  } catch (e) {
    log(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

$('test').addEventListener('click', async () => {
  const p = current();
  if (!p) return log('Give a URL and a pin first.');
  log(`Connecting to ${p.url}…`);
  try {
    const r = await roundTrips(p, 200);
    log(`status: ${JSON.stringify(r.firstReply).slice(0, 300)}`);
    log(
      `connect ${r.connectMs.toFixed(0)} ms · 200 round trips: p50 ${r.p50.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms, max ${r.max.toFixed(2)} ms, ${r.perSecond.toFixed(0)} msg/s`,
    );
  } catch (e) {
    log(`Failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

$('save').addEventListener('click', () => {
  const p = current();
  if (!p) return log('Give a URL and a pin first.');
  writePairing(p);
  location.replace('/');
});

$('forget').addEventListener('click', () => {
  clearPairing();
  log('Pairing forgotten.');
});

const saved = readPairing();
if (saved) fill(saved);

Object.assign(window, {
  coasysDiag: {
    open: async (url: string, pin: string) => {
      const r = await open(url, pin);
      r.socket?.close();
      return { ok: r.ok, kind: r.kind, message: r.message, ms: r.ms };
    },
    roundTrips,
    runtimeInfo: () => CoasysTransport.runtimeInfo(),
    PinnedWebSocket,
  },
});
