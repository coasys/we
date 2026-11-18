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
 * The smallest honest socket for RPCs the pinned client's method table does not
 * know: one lazily opened WebSocket on the session's own url and token, pending
 * calls matched by id. `globalThis.WebSocket` rather than a `ws` dependency —
 * this adapter runs where a WebSocket already is (the app, or Node ≥21 for a
 * host-side call), and taking the constructor as a parameter would push a
 * transport detail into the port's signature for no gain.
 */
function a9Calls(
  connection: () => Ad4mHttpConnection | null | undefined,
): <T>(method: string, params: object) => Promise<T> {
  let socket: Promise<WebSocket> | null = null;
  let nextId = 1;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  const open = (conn: Ad4mHttpConnection): Promise<WebSocket> => {
    socket ??= new Promise((resolve, reject) => {
      const base = conn.url.replace(/\/+$/, '').replace(/^http/, 'ws');
      // An executor run without credential checks accepts an empty socket; one
      // with them wants the token the session already holds — the same param
      // the pinned ApiClient sends.
      const auth = conn.token ? `?token=${encodeURIComponent(conn.token)}` : '';
      const ws = new WebSocket(`${base}/api/v1/ws${auth}`);
      ws.onmessage = ({ data }) => {
        const msg = JSON.parse(String(data)) as {
          id?: string | number;
          result?: unknown;
          error?: { message?: string };
        };
        const call = msg.id != null && pending.get(String(msg.id));
        if (!call) return; // event frames carry no pending id — not ours to read
        pending.delete(String(msg.id));
        if (msg.error) call.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        else call.resolve(msg.result);
      };
      ws.onerror = () => reject(new Error('acornLifecycle: the mount/template socket refused to open'));
      ws.onclose = () => {
        socket = null;
        const gone = new Error('acornLifecycle: the mount/template socket closed');
        for (const call of pending.values()) call.reject(gone);
        pending.clear();
      };
      ws.onopen = () => resolve(ws);
    });
    return socket;
  };

  return async <T>(method: string, params: object): Promise<T> => {
    const conn = connection();
    if (!conn?.url) {
      throw new Error('acornLifecycle: the connection handed no url — is the session connected?');
    }
    const ws = await open(conn);
    const id = String(nextId++);
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ws.send(JSON.stringify({ id, type: method, params }));
    });
  };
}

export function createAd4mAcornLifecycle(
  backendClient: unknown,
  connection: () => Ad4mHttpConnection | null | undefined,
): AcornLifecyclePort {
  const client = backendClient as Ad4mClient;
  const call = a9Calls(connection);

  return {
    applyTemplateLocal: (sourceLanguageHash, templateData) =>
      // `templateData` travels as a stringified field — the wire shape the a9
      // `LanguageClient` and the rig's `ad4m.mjs` both write.
      call<{ address: string }>('language.applyTemplateLocal', {
        sourceLanguageHash,
        templateData: JSON.stringify(templateData),
      }),
    mount: (datasetId, languageAddress) => call<boolean>('perspective.mount', { uuid: datasetId, languageAddress }),
    mounts: (datasetId) => call<string[]>('perspective.mounts', { uuid: datasetId }),
    unmount: (datasetId, languageAddress) => call<boolean>('perspective.unmount', { uuid: datasetId, languageAddress }),
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
