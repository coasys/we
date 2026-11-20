/**
 * The host port over AD4M's `host.*` and `data.*` calls.
 *
 * The **operator** half is the executor this app is signed in to (`client`), whose `host.*` policy,
 * invite and tenant calls its operator makes. The **tenant** half is a session on another host: the
 * person logs in there with their device key, which on a computer is this computer's own executor
 * signing the statement (`agent.signSessionStatement`, {@link executorSigner}), so the host sees the
 * person and never a password. The key session ({@link keySession}) is the one the phone also uses.
 *
 * The token the host gives is held here, in memory, for as long as the session is open: it is never
 * written anywhere, and the renewal replaces it each hour.
 */
import { Ad4mClient } from '@coasys/ad4m';
import type { HostPort, TenantHostPort } from '@we/backend-shared';

import {
  executorSigner,
  keepRenewed,
  KEY_SESSION_APP,
  type KeySession,
  type KeySigner,
  loginWithDeviceKey,
  type Renewal,
} from './keySession';

/** A tenant's open session on one host. */
interface OpenSession {
  client: Ad4mClient;
  renewal: Renewal;
}

/** What a test supplies in place of the network: the client a URL is dialled with. */
export interface HostPortDeps {
  connect?: (url: string, token?: string) => Ad4mClient;
  signer?: KeySigner;
}

export function createAd4mHostPort(client: Ad4mClient, deps: HostPortDeps = {}): HostPort {
  const connect = deps.connect ?? ((url: string, token?: string) => new Ad4mClient(url, token));
  const signer = deps.signer ?? executorSigner(client.agent);

  /** Logs in to the host at `url` as the person, and keeps the session renewed. */
  async function login(url: string, ended: () => void): Promise<OpenSession> {
    // A challenge and a login need no token: a client of this try's own, closed once it has answered.
    const anonymous = connect(url);
    let session: KeySession;
    try {
      session = await loginWithDeviceKey(signer, anonymous.agent, url, KEY_SESSION_APP);
    } finally {
      anonymous.close();
    }
    const tenant = connect(url, session.token);
    const renewal = keepRenewed({
      signer,
      agent: tenant.agent,
      url,
      session,
      onToken: (token) => tenant.setToken(token),
      onExpired: () => {
        tenant.close();
        ended();
      },
    });
    return { client: tenant, renewal };
  }

  function tenant(url: string): TenantHostPort {
    let open: Promise<OpenSession> | null = null;

    /** The session, opened on first use; one that failed or ended is opened afresh by the next call. */
    const session = (): Promise<Ad4mClient> => {
      if (!open) {
        const attempt = login(url, () => {
          if (open === attempt) open = null;
        });
        open = attempt;
        attempt.catch(() => {
          if (open === attempt) open = null;
        });
      }
      return open.then((s) => s.client);
    };

    return {
      usage: async () => (await session()).host.usage(),
      leave: async (keepData) => {
        const left = await (await session()).host.leave(keepData);
        // The session belongs to a tenant that is no longer there.
        close();
        return left;
      },
      exportFile: async () => (await session()).data.exportFile(),
      importFile: async (file) => (await session()).data.importFile(file),
      close,
    };

    function close(): void {
      const was = open;
      open = null;
      void was?.then(
        (s) => {
          s.renewal.stop();
          s.client.close();
        },
        () => {},
      );
    }
  }

  return {
    operator: {
      info: () => client.host.info(),
      policy: () => client.host.policy(),
      setPolicy: (patch) => client.host.setPolicy(patch),
      createInvite: (days, note) => client.host.createInvite(days, note),
      listInvites: () => client.host.listInvites(),
      revokeInvite: (id) => client.host.revokeInvite(id),
      tenants: () => client.host.tenants(),
      removeTenant: async (id) => (await client.host.removeTenant(id)).removed,
    },
    tenant,
  };
}
