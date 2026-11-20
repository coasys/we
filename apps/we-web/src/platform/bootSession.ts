/**
 * The boot session: a session an embedding host hands WE at start.
 *
 * The ad4m Docker entrypoint and the SFU's Electron client run WE against an executor they already
 * hold a token for. They used to write that token into `localStorage` for the old connect library.
 * Now they set one global before WE's script runs:
 *
 *     window.__WE_AD4M_SESSION = { url: 'http://127.0.0.1:12000', token: '<token>' }
 *
 * WE reads it once, at start, and removes it from `window`. Nothing writes it to storage: the token
 * lives in this page's memory, like every other session. WE does not renew it; the host that issued
 * it owns its lifetime.
 */
import { Ad4mClient } from '@coasys/ad4m';
import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';

import { backendFor } from './ad4mConnector';

/** What the host hands over. */
export interface BootSession {
  /** The executor: an `http(s)` or `ws(s)` URL. */
  url: string;
  /** A token the executor issued: a grant, or its operator credential. */
  token: string;
}

declare global {
  interface Window {
    __WE_AD4M_SESSION?: unknown;
  }
}

/** The executor's HTTP base for `url`, or null when `url` is not an executor address. */
function executorBase(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const { protocol, host } = new URL(url);
  if (protocol === 'http:' || protocol === 'https:') return `${protocol}//${host}`;
  if (protocol === 'ws:' || protocol === 'wss:') return `${protocol === 'ws:' ? 'http:' : 'https:'}//${host}`;
  return null;
}

/**
 * The session the host set, removed from `window` as it is read; null when the host set none or
 * set something that is not `{ url, token }` (that case is logged: the host meant to hand one over).
 */
export function takeBootSession(win: Window = window): BootSession | null {
  const raw = win.__WE_AD4M_SESSION;
  if (raw === undefined) return null;
  delete win.__WE_AD4M_SESSION;
  const { url, token } = (raw ?? {}) as Partial<Record<keyof BootSession, unknown>>;
  if (typeof url === 'string' && typeof token === 'string' && token && executorBase(url)) return { url, token };
  console.error('[WE] window.__WE_AD4M_SESSION must be { url, token }: an executor address and a token. Ignored.');
  return null;
}

/** The connector for a boot session: the executor is the host's, and so is the token. */
export function createSessionConnector(session: BootSession): BackendConnector {
  return {
    async initialize(ctx): Promise<BackendInitResult> {
      const baseUrl = executorBase(session.url)!;
      const client = new Ad4mClient(baseUrl, session.token);
      // A token the executor refuses stops the boot here, with the executor's words, rather than
      // surfacing as the first query that fails.
      await client.agent.status();
      const { port, protocol } = new URL(baseUrl);
      return backendFor(
        client,
        {
          token: session.token,
          baseUrl,
          port: Number(port) || (protocol === 'https:' ? 443 : 80),
          authState: 'authenticated',
          disconnect: async () => {
            await client.agent.logout().catch(() => {});
            client.close();
          },
        },
        ctx,
      );
    },
  };
}
