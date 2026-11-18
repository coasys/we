/**
 * The AD4M `acornLifecycle` port — `perspective.mount`/`mounts`/`unmount`,
 * `language.applyTemplateLocal` and `expression.interact`, as the neutral
 * {@link AcornLifecyclePort}.
 *
 * ## The transport split
 *
 * `expression.interact` goes through the session's own `Ad4mClient`, which the
 * pinned SDK carries. The mount and template calls are RPCs from ad4m's
 * `acorn/a9-mount-lifecycle` branch — the executor binary answers them, but the
 * SDK this repo pins (`667d43e`, a9's base) has neither the client methods nor
 * their `RpcMethods` entries yet, so they go over a second socket on the same
 * connection, opened on first use. The frame is the executor's own WS protocol —
 * `{id, type: <method>, params}` out, `{id, result|error}` back — the same one
 * the rig drives (`acorn-ad4m/rig/ad4m.mjs`); a second `ApiClient` would do, but
 * the pin's package hides it behind extensionless deep imports no consumer here
 * can resolve.
 *
 * When the pin reaches a build carrying the a9 methods this port's transport
 * collapses back to `client.perspective.mount(...)` /
 * `client.languages.applyTemplateLocal(...)` — the port surface does not change.
 */
import type { Ad4mClient } from '@coasys/ad4m';
import { InteractionCall } from '@coasys/ad4m';
import type { AcornLifecyclePort } from '@we/backend-shared';

import type { Ad4mHttpConnection } from './languageModelPort';

/**
 * How long a socket's open gets before the call that asked for it is let go —
 * a socket nobody answers is the executor refusing, not an invitation to wait
 * forever.
 */
export const A9_CONNECT_TIMEOUT_MS = 10_000;
/**
 * How long one rpc gets before its caller is let go — the same 30 s the pinned
 * client's own `call` uses (`ApiClient` resolveTimeout), so the two sockets a
 * session holds are governed by one convention.
 */
export const A9_REQUEST_TIMEOUT_MS = 30_000;

interface A9Socket {
  call<T>(method: string, params: object): Promise<T>;
  /** The session this socket authenticated under ended — close it and let every pending call hear. */
  dispose(): void;
}

/**
 * The smallest honest socket for RPCs the pinned client's method table does not
 * know: one lazily opened WebSocket on the session's own url and token, pending
 * calls matched by id and bounded by a timer each. `globalThis.WebSocket` rather
 * than a `ws` dependency — this adapter runs where a WebSocket already is (the
 * app, or Node ≥21 for a host-side call), and taking the constructor as a
 * parameter would push a transport detail into the port's signature for no gain.
 *
 * Two rules, both from the session's side. **Every call is bounded**: a request
 * whose reply never comes is rejected after `A9_REQUEST_TIMEOUT_MS`, and an open
 * that never completes after `A9_CONNECT_TIMEOUT_MS` — a `pending` entry is a
 * timer, not an appointment. **The socket is the session's**: `dispose` ends it
 * when the session does, and a `connection()` that starts answering different
 * credentials — a re-authorised session — sees the old one closed before a call
 * of the new one goes out, since its token is not ours to keep using.
 */
function a9Socket(connection: () => Ad4mHttpConnection | null | undefined): A9Socket {
  let socket: Promise<WebSocket> | null = null;
  let live: WebSocket | null = null;
  let socketFor = '';
  let disposed = false;
  let nextId = 1;
  /*
    The in-flight connect's reject — a caller awaiting `open()` is not in `pending`
    yet, so `release` can never reach it, and the close handler's stale-socket guard
    means the corpse's `onclose` will not either. Closing this socket has to settle
    that promise itself, or the caller waits out the connect timeout for an answer
    the session already knew.
  */
  let settleOpen: ((error: Error) => void) | null = null;
  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  /** One answer to everything still out — the socket is gone, not slow. */
  const release = (error: Error) => {
    const calls = [...pending.values()];
    pending.clear();
    for (const call of calls) {
      clearTimeout(call.timer);
      call.reject(error);
    }
  };

  const closeSocket = (error: Error) => {
    const gone = socket;
    socket = null;
    // `live` before `settle` — the settle function clears it on its own way out.
    const ws = live;
    live = null;
    const settle = settleOpen;
    settleOpen = null;
    release(error);
    // Close the socket itself — `live` is the object even while its open is
    // still in flight, which `gone.then` could never reach.
    try {
      ws?.close();
    } catch {
      /* closing a broken socket is allowed to fail */
    }
    settle?.(error);
    // Whatever it was doing settles here — a promise nobody awaits must not go
    // on to reject (or open) on its own account.
    void gone?.then(
      () => undefined,
      () => undefined,
    );
  };

  const open = (conn: Ad4mHttpConnection): Promise<WebSocket> => {
    // url+token — the credentials the socket authenticates as. A session that
    // re-authorised under us is a different session: the old socket closes
    // before the new one's first call.
    const key = `${conn.url}\n${conn.token ?? ''}`;
    if (socket && socketFor !== key) {
      closeSocket(new Error('acornLifecycle: the session changed under the mount/template socket'));
    }
    if (socket) return socket;

    const promise = new Promise<WebSocket>((resolve, reject) => {
      const base = conn.url.replace(/\/+$/, '').replace(/^http/, 'ws');
      // An executor run without credential checks accepts an empty socket; one
      // with them wants the token the session already holds — the same param
      // the pinned ApiClient sends.
      const auth = conn.token ? `?token=${encodeURIComponent(conn.token)}` : '';
      const ws = new WebSocket(`${base}/api/v1/ws${auth}`);
      live = ws;
      const opened = () => {
        clearTimeout(connectTimer);
        if (settleOpen === failed) settleOpen = null;
        resolve(ws);
      };
      const failed = (error: Error) => {
        clearTimeout(connectTimer);
        if (socket === promise) socket = null;
        if (live === ws) live = null;
        if (settleOpen === failed) settleOpen = null;
        reject(error);
      };
      settleOpen = failed;
      const connectTimer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* closing a socket that never opened is allowed to fail */
        }
        failed(new Error('acornLifecycle: the mount/template socket did not open in time'));
      }, A9_CONNECT_TIMEOUT_MS);
      ws.onmessage = ({ data }) => {
        let msg: { id?: string | number; result?: unknown; error?: { message?: string } };
        try {
          msg = JSON.parse(String(data)) as typeof msg;
        } catch {
          return; // a frame that is not a reply — not ours to read, not fatal either
        }
        const call = msg.id != null && pending.get(String(msg.id));
        if (!call) return; // event frames carry no pending id — not ours to read
        pending.delete(String(msg.id));
        clearTimeout(call.timer);
        if (msg.error) call.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        else call.resolve(msg.result);
      };
      ws.onerror = () => failed(new Error('acornLifecycle: the mount/template socket refused to open'));
      ws.onclose = () => {
        if (socket !== promise) {
          if (live === ws) live = null;
          return; // a corpse's close must not clear its replacement
        }
        // May still be opening: reject the open promise too, or the caller
        // waits for a resolve that will never come.
        failed(new Error('acornLifecycle: the mount/template socket closed before it opened'));
        release(new Error('acornLifecycle: the mount/template socket closed'));
      };
      ws.onopen = opened;
    });
    socket = promise;
    socketFor = key;
    return promise;
  };

  const call = <T>(method: string, params: object): Promise<T> => {
    if (disposed) {
      return Promise.reject(new Error('acornLifecycle: the session this socket belonged to ended'));
    }
    const conn = connection();
    if (!conn?.url) {
      return Promise.reject(new Error('acornLifecycle: the connection handed no url — is the session connected?'));
    }
    return open(conn).then(
      (ws) =>
        new Promise<T>((resolve, reject) => {
          const id = String(nextId++);
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`acornLifecycle: ${method} heard nothing for ${A9_REQUEST_TIMEOUT_MS / 1000}s`));
          }, A9_REQUEST_TIMEOUT_MS);
          pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
          try {
            ws.send(JSON.stringify({ id, type: method, params }));
          } catch (err) {
            clearTimeout(timer);
            pending.delete(id);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }),
    );
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    closeSocket(new Error('acornLifecycle: the session this socket belonged to ended'));
  };

  return { call, dispose };
}

export function createAd4mAcornLifecycle(
  backendClient: unknown,
  connection: () => Ad4mHttpConnection | null | undefined,
): AcornLifecyclePort {
  const client = backendClient as Ad4mClient;
  const socket = a9Socket(connection);

  return {
    applyTemplateLocal: (sourceLanguageHash, templateData) =>
      // `templateData` travels as a stringified field — the wire shape the a9
      // `LanguageClient` and the rig's `ad4m.mjs` both write.
      socket.call<{ address: string }>('language.applyTemplateLocal', {
        sourceLanguageHash,
        templateData: JSON.stringify(templateData),
      }),
    mount: (datasetId, languageAddress) =>
      socket.call<boolean>('perspective.mount', { uuid: datasetId, languageAddress }),
    mounts: (datasetId) => socket.call<string[]>('perspective.mounts', { uuid: datasetId }),
    unmount: (datasetId, languageAddress) =>
      socket.call<boolean>('perspective.unmount', { uuid: datasetId, languageAddress }),
    // The second socket is this port's own — it ends with the session, not with the page.
    dispose: () => socket.dispose(),
    interact: async (url, callSpec) => {
      const result = await client.expression.interact(
        url,
        new InteractionCall(callSpec.name, callSpec.parameters ?? {}),
      );
      if (typeof result !== 'string') return result;
      try {
        return JSON.parse(result) as unknown;
      } catch {
        return result;
      }
    },
  };
}
