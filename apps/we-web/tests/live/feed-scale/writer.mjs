/**
 * The seeding's connection to the executor: the same two calls `PerspectiveClient` makes
 * (`perspective.addLinks`, `perspective.addLinkExpression`), the same frames, and no client-side
 * timeout.
 *
 * Why not `Ad4mClient`: its calls give up after 30 s (`DEFAULT_TIMEOUT_MS`), and `addLinks` takes no
 * option to change that. The executor writes one transaction at a time per perspective, so a write
 * waits behind every write queued before it, and that wait grows with the store: at 90 000 messages a
 * queued batch passed 30 s and the run failed. A write that timed out on the client still runs to
 * its end on the executor, so it cannot be sent again without writing it twice. What the executor is
 * asked to do, and the path it takes to do it, are the same as through the SDK; only the client stops
 * keeping a clock on it. A dropped connection still fails every call it holds.
 */
import { linkExpressionToWire } from '@coasys/ad4m';

/**
 * One WebSocket to the executor at `url` (http or https), as `token`.
 * @returns {Promise<{ addLinks, addLinkExpression, close }>}
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
    addLinks: (uuid, links, status) => call('perspective.addLinks', { uuid, links, status }),
    addLinkExpression: (uuid, link, status) =>
      call('perspective.addLinkExpression', { uuid, link: linkExpressionToWire(link), status }),
    close: () => ws.close(),
  };
}
