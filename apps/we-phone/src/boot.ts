/**
 * Runs before WE's own bundle, from a classic script the assembly step puts in WE's index.html.
 *
 * With no pairing there is nothing for WE to connect to — the phone runs no executor — so it opens
 * the pairing screen instead. With one, it does the three things WE's unchanged build needs:
 *
 * 1. `globalThis.WebSocket` sends the desktop's URLs through the pinned Rust connection
 *    (`installPinnedWebSocket`). The ad4m client falls back to `globalThis.WebSocket` because WE
 *    passes it no `webSocketImpl`.
 * 2. `globalThis.fetch` does the same for HTTPS to the desktop (`installPinnedFetch`):
 *    ad4m-connect checks `GET <base>/health` before it opens the socket, and the WebView would
 *    refuse the self-signed certificate.
 * 3. ad4m-connect's stored URL (and the token, when the pairing has one) name the desktop, so its
 *    first connection goes there instead of to `localhost:12000`, where a phone has nothing.
 */
import { installPinnedFetch, installPinnedWebSocket } from '@coasys/capacitor-transport';

import { readPairing } from './pairing';

declare const __AD4M_CONNECT_VERSION__: string;

const pairing = readPairing();
if (!pairing) {
  location.replace('/phone/diag.html');
} else {
  installPinnedWebSocket(pairing);
  installPinnedFetch(pairing);
  // ad4m-connect keeps its settings under `<its version>/<key>`; the assembly step reads the
  // version from the build it copied, so these are the keys that build reads.
  const prefix = `${__AD4M_CONNECT_VERSION__}/`;
  const httpBase = pairing.url.replace(/^wss:\/\//, 'https://').replace(/\/+$/, '');
  localStorage.setItem(`${prefix}ad4m-url`, httpBase);
  if (pairing.token) localStorage.setItem(`${prefix}ad4m-token`, pairing.token);
}
