/**
 * Minimal AD4M WebSocket RPC client for e2e test setup.
 *
 * Uses Node's built-in WebSocket (Node ≥ 21). No external dependencies.
 * Handles: user creation, login, agent status — enough to bootstrap auth
 * without ad4m-connect's interactive UI flow.
 */

interface RpcResponse {
  id: string;
  result?: unknown;
  error?: { message: string; code?: number };
}

export interface Ad4mRpcConfig {
  /** WebSocket URL (default: ws://127.0.0.1:12000/api/v1/ws) */
  wsUrl?: string;
  /** Admin credential / token (default: test123) */
  token?: string;
  /** Timeout per RPC call in ms (default: 15000) */
  timeout?: number;
}

const defaults = {
  wsUrl: 'ws://127.0.0.1:12000/api/v1/ws',
  token: 'test123',
  timeout: 15_000,
};

/**
 * Make a single RPC call and close the connection.
 *
 * The AD4M WS-RPC protocol sends JSON:
 *   → { id, type: "method.name", params: {...} }
 *   ← { id, result | error }
 */
export async function rpcCall(
  method: string,
  params: Record<string, unknown> = {},
  config: Ad4mRpcConfig = {},
): Promise<unknown> {
  const wsUrl = config.wsUrl ?? defaults.wsUrl;
  const token = config.token ?? defaults.token;
  const timeout = config.timeout ?? defaults.timeout;

  const fullUrl = wsUrl.includes('?') ? `${wsUrl}&token=${token}` : `${wsUrl}?token=${token}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(fullUrl);
    const reqId = crypto.randomUUID();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error(`RPC timeout: ${method} after ${timeout}ms`));
      }
    }, timeout);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: reqId, type: method, params }));
    });

    ws.addEventListener('message', (event) => {
      if (settled) return;
      try {
        const resp: RpcResponse = JSON.parse(String(event.data));
        if (resp.id !== reqId) return; // ignore subscription messages
        settled = true;
        clearTimeout(timer);
        ws.close();
        if (resp.error) {
          reject(new Error(`RPC error [${method}]: ${resp.error.message}`));
        } else {
          resolve(resp.result);
        }
      } catch (_e) {
        // Not JSON or wrong shape — keep waiting
      }
    });

    ws.addEventListener('error', (_event) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`WebSocket error connecting to ${wsUrl}`));
      }
    });

    ws.addEventListener('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`WebSocket closed before response for ${method}`));
      }
    });
  });
}

/**
 * Ensure a test user exists and return a JWT for that user.
 *
 * Idempotent: swallows "already exists" from user.create.
 */
export async function ensureUserAndLogin(
  email = 'dev@test.com',
  password = 'test123',
  config: Ad4mRpcConfig = {},
): Promise<string> {
  // Create user (ignore errors — may already exist)
  try {
    await rpcCall('user.create', { email, password }, config);
  } catch {
    // Already exists — fine
  }

  // Login
  const jwt = await rpcCall('user.login', { email, password }, config);
  if (typeof jwt !== 'string' || jwt.length < 10) {
    throw new Error(`Login failed: expected JWT string, got ${JSON.stringify(jwt)}`);
  }
  return jwt.replace(/^"|"$/g, '');
}

/**
 * Get agent status — confirms the executor runs and an agent exists.
 */
export async function agentStatus(config: Ad4mRpcConfig = {}): Promise<{
  did: string;
  isInitialized: boolean;
  isUnlocked: boolean;
}> {
  const result = await rpcCall('agent.status', {}, config);
  return result as { did: string; isInitialized: boolean; isUnlocked: boolean };
}
