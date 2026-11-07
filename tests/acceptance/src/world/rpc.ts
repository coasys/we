/**
 * The executor's RPC over its WebSocket (`/api/v1/ws`), as the Rust client speaks it: a message is
 * `{ id, type, params }` and its answer `{ id, result }` or `{ id, error }`.
 *
 * World building only: a scenario acts through the apps, and reads an executor this way only to
 * check what an app did.
 */
export async function rpc<T = unknown>(
  executorUrl: string,
  token: string,
  type: string,
  params: unknown = {},
): Promise<T> {
  const base = executorUrl
    .replace(/^http:/, 'ws:')
    .replace(/^https:/, 'wss:')
    .replace(/\/$/, '');
  const url = `${base}/api/v1/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const socket = new WebSocket(url);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error(`no connection to ${base}`)), { once: true });
    });
    const id = `acceptance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const answer = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${type}: no answer in 120 s`)), 120_000);
      socket.addEventListener('message', (event) => {
        let message: { id?: string; result?: T; error?: { code?: number; message?: string } };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.id !== id) return;
        clearTimeout(timer);
        if (message.error) reject(new Error(`${type}: ${message.error.code ?? 500} ${message.error.message ?? ''}`));
        else resolve(message.result as T);
      });
      socket.addEventListener('close', () => reject(new Error(`${type}: the connection closed`)), { once: true });
    });
    socket.send(JSON.stringify({ id, type, params }));
    return await answer;
  } finally {
    socket.close();
  }
}
