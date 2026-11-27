#!/usr/bin/env node
/**
 * Evaluates an expression in the app's WebView over the DevTools protocol and prints the result as
 * JSON. How the spike's measurements are taken on an emulator or a USB phone, with no tapping.
 *
 *   node scripts/cdp-eval.mjs "await coasysDiag.roundTrips({url:'wss://10.0.2.2:8443', pin:'…'}, 200)"
 *   node scripts/cdp-eval.mjs --page diag "location.href"
 *
 * Needs `adb` on PATH and a debug build (Capacitor enables WebView debugging only there). It
 * forwards a local port to the WebView's DevTools socket, picks the page whose URL contains
 * `--page` (default: the first), and runs the expression inside an async function.
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
let pageFilter = '';
if (args[0] === '--page') {
  pageFilter = args[1];
  args.splice(0, 2);
}
const expression = args.join(' ');
if (!expression) {
  console.error('usage: cdp-eval.mjs [--page <url part>] <expression>');
  process.exit(2);
}

const sockets = execFileSync('adb', ['shell', 'cat', '/proc/net/unix'], { encoding: 'utf8' }).match(
  /webview_devtools_remote_\d+/g,
);
const pid = execFileSync('adb', ['shell', 'pidof', 'org.coasys.app'], { encoding: 'utf8' }).trim();
// Other apps' WebViews have sockets too; the app's is named by its pid.
const socket = sockets?.find((s) => s === `webview_devtools_remote_${pid}`);
if (!socket) throw new Error('No WebView DevTools socket for org.coasys.app: is the debug app running?');
const port = 9333;
execFileSync('adb', ['forward', `tcp:${port}`, `localabstract:${socket}`]);

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === 'page' && p.url.includes(pageFilter));
if (!page) throw new Error(`No page matching "${pageFilter}": ${pages.map((p) => p.url).join(', ')}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const reply = await new Promise((resolve) => {
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id === 1) resolve(msg);
  };
  ws.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `(async () => { return (${expression}); })()`,
        awaitPromise: true,
        returnByValue: true,
      },
    }),
  );
});
ws.close();
if (reply.result?.exceptionDetails) {
  console.error(JSON.stringify(reply.result.exceptionDetails, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(reply.result?.result?.value, null, 2));
