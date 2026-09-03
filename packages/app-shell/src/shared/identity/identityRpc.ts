/**
 * Lightweight WS-RPC client for AD4M identity handlers.
 *
 * Identity handlers use custom message types (`identity.resolve`, `identity.roster`, etc.)
 * outside the GraphQL schema. This helper speaks the executor's WebSocket protocol.
 */

export interface IdentityRpcConfig {
  wsUrl: string; // e.g. 'ws://localhost:12000/api/v1/ws'
  token: string;
}

/**
 * Send a single identity RPC call and return the result.
 *
 * Opens a dedicated WebSocket per call — acceptable because identity data loads once at boot
 * and actions (export, revoke) fire rarely.
 */
export async function identityRpc<T = unknown>(
  config: IdentityRpcConfig,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${config.wsUrl}?token=${config.token}`);
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Identity RPC timeout: ${method}`));
    }, 15_000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ id, type: method, params }));
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string);
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) reject(new Error(msg.error.message ?? `RPC error: ${method}`));
      else resolve(msg.result as T);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error during ${method}`));
    };
  });
}
