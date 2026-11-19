/**
 * The seeding's connection to the executor: the one call `runtime.importData` needs, over the same
 * WebSocket the SDK uses (`/api/v1/ws?token=…`), with no client-side timeout.
 *
 * Why not `Ad4mClient`: its calls give up after 30 s (`DEFAULT_TIMEOUT_MS`), and loading a file of
 * twelve million links can take longer, so the suite sends `runtime.importData` on a raw socket and
 * waits for the answer however long it takes. What the executor is
 * asked to do, and the frames that carry it, are the same as through the SDK; only the client stops
 * keeping a clock on it. A dropped connection still fails the call it holds.
 *
 * `token` must be the executor's admin credential: `runtime.importData` is operator-only and
 * refuses a managed user's token.
 */

/**
 * One WebSocket to the executor at `url` (http or https), as `token`.
 * @returns {Promise<{ importPerspective, close }>}
 */
export async function openWriter(url, token) {
  const wsUrl = `${url.replace(/^http/, 'ws')}/api/v1/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let next = 0;
  let closed = null;

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`could not connect to ${url}`));
  });
  ws.onerror = null;
  ws.onclose = (event) => {
    closed = new Error(`the executor closed the connection (${event.code} ${event.reason})`);
    for (const { reject } of pending.values()) reject(closed);
    pending.clear();
  };
  ws.onmessage = (event) => {
    let reply;
    try {
      reply = JSON.parse(String(event.data));
    } catch {
      return;
    }
    // Events carry a `type`; replies do not.
    if (reply.type !== undefined) return;
    const call = pending.get(reply.id);
    if (!call) return;
    pending.delete(reply.id);
    if (reply.error) call.reject(new Error(`${call.type}: ${reply.error.code} ${reply.error.message}`));
    else call.resolve(reply.result);
  };

  const call = (type, params) => {
    if (closed) return Promise.reject(closed);
    const id = String(++next);
    return new Promise((resolve, reject) => {
      pending.set(id, { type, resolve, reject });
      ws.send(JSON.stringify({ id, type, params }));
    });
  };

  return {
    importPerspective: (uuid, filePath) =>
      call('runtime.importData', { type: 'perspective', filePath, perspectiveUuid: uuid }),
    close: () => ws.close(),
  };
}
