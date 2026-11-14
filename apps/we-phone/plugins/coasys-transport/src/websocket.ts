/**
 * A `WebSocket` whose bytes go through the plugin, not through the WebView.
 *
 * The WebView cannot open this connection itself: the desktop's certificate is self-signed, and the
 * only thing that makes it trustworthy is the pin from the QR code, which a WebView has no way to
 * check. So the socket is a shape: it looks like the DOM `WebSocket` to the code using it, and the
 * plugin's Rust side does the TLS, the pin check and the frames.
 *
 * Text frames only. The executor's JSON-RPC sends nothing else.
 */
import type { PluginListenerHandle } from '@capacitor/core';

import type {
  CloseEvent as PluginClose,
  ErrorEvent as PluginError,
  MessageEvent as PluginMessage,
} from './definitions';
import { CoasysTransport } from './plugin';

/** What the QR code carries. */
export interface Pairing {
  url: string;
  pin: string;
}

type Listener = (event: Event) => void;

const sockets = new Map<string, PinnedWebSocket>();
let listening: Promise<PluginListenerHandle[]> | null = null;
let counter = 0;

/**
 * One set of plugin listeners for every socket, dispatched by id. Registered once per page, after
 * closing whatever an earlier page in this WebView left open: its sockets have no page left to
 * read them, and in Rust they would stay open until the app exits.
 */
function listen(): Promise<PluginListenerHandle[]> {
  listening ??= CoasysTransport.reset().then(() =>
    Promise.all([
      CoasysTransport.addListener('open', (e) => sockets.get(e.id)?._opened()),
      CoasysTransport.addListener('message', (e: PluginMessage) => sockets.get(e.id)?._message(e.text)),
      CoasysTransport.addListener('error', (e: PluginError) => sockets.get(e.id)?._error(e.kind, e.message)),
      CoasysTransport.addListener('close', (e: PluginClose) => sockets.get(e.id)?._closed(e.code, e.reason)),
    ]),
  );
  return listening;
}

export class PinnedWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  readonly protocol = '';
  readonly extensions = '';
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  readyState = 0;

  onopen: Listener | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: Listener | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  /** The kind of the last failure (`pin-mismatch`, …), for a caller that wants to say why. */
  errorKind: string | null = null;

  private readonly id: string;
  private closeRequested = false;

  constructor(url: string | URL, pin: string) {
    super();
    this.url = String(url);
    this.id = `ws-${Date.now().toString(36)}-${++counter}`;
    sockets.set(this.id, this);
    void listen()
      .then(() => CoasysTransport.connect({ id: this.id, url: this.url, pin }))
      .then(() => {
        if (this.closeRequested) void CoasysTransport.close({ id: this.id });
      })
      .catch((e: unknown) => {
        // Refused at the call (a bad URL or pin): no connection exists, so end it here.
        this._error('unreachable', e instanceof Error ? e.message : String(e));
        this._closed(1006, 'unreachable');
      });
  }

  send(data: string): void {
    if (this.readyState === 0) throw new DOMException('Still in CONNECTING state.', 'InvalidStateError');
    if (this.readyState !== 1) return;
    if (typeof data !== 'string') throw new TypeError('PinnedWebSocket sends text frames only');
    CoasysTransport.send({ id: this.id, text: data }).catch(() => {
      // The connection ended under the send; its close event says so.
    });
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.closeRequested = true;
    void CoasysTransport.close({ id: this.id }).catch(() => {});
  }

  /** @internal */
  _opened(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.fire(new Event('open'), this.onopen);
  }

  /** @internal */
  _message(text: string): void {
    if (this.readyState !== 1) return;
    this.fire(new MessageEvent('message', { data: text, origin: this.url }), this.onmessage as Listener | null);
  }

  /** @internal */
  _error(kind: string, message: string): void {
    this.errorKind = kind;
    const event = new Event('error');
    Object.assign(event, { kind, message });
    this.fire(event, this.onerror);
  }

  /** @internal */
  _closed(code: number, reason: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    sockets.delete(this.id);
    this.fire(new CloseEvent('close', { code, reason, wasClean: code !== 1006 }), this.onclose as Listener | null);
  }

  private fire(event: Event, handler: Listener | null): void {
    try {
      handler?.call(this, event);
    } finally {
      this.dispatchEvent(event);
    }
  }
}

/**
 * Replaces `globalThis.WebSocket` with one that sends the paired desktop's URLs through the plugin
 * and everything else through the WebView, as before.
 *
 * This is the whole switch WE needs. The ad4m client opens its socket with
 * `new (webSocketImpl ?? globalThis.WebSocket)(url)`, and WE passes no `webSocketImpl`, so nothing in
 * WE's source changes: the phone app installs this before WE's bundle runs.
 *
 * A URL is the desktop's when its origin (scheme, host, port) is the pairing's.
 */
export function installPinnedWebSocket(pairing: Pairing): void {
  const Native = globalThis.WebSocket;
  const paired = new URL(pairing.url);
  const origin = `${paired.hostname}:${paired.port || '443'}`;
  const isPaired = (url: string | URL): boolean => {
    try {
      const u = new URL(String(url));
      return u.protocol === 'wss:' && `${u.hostname}:${u.port || '443'}` === origin;
    } catch {
      return false;
    }
  };

  const Switching = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    if (isPaired(url)) return new PinnedWebSocket(url, pairing.pin);
    return new Native(url, protocols);
  } as unknown as typeof WebSocket;
  Object.assign(Switching, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  Switching.prototype = Native.prototype;
  globalThis.WebSocket = Switching;
}
