import { Ad4mClient } from '@coasys/ad4m';

/** How connect reaches the executor in embedded proxy mode — its private `proxy` field. */
interface ConnectProxy {
  baseUrl: string;
  options: ConstructorParameters<typeof Ad4mClient>[2];
}

/** The parts of an ad4m-connect core the session client is built from. */
export interface ConnectCoreLike {
  baseUrl: string;
  token: string;
}

/**
 * The session's client, on this bundle's own `@coasys/ad4m`, over the transport connect
 * authenticated with.
 *
 * connect resolves with a client of the SDK copy it vendors — an older one without mount,
 * `shapes()` or the `instance*` writes — so the ports get a client of our own. It has to ride the
 * same transport. Embedded behind `AD4M_CONFIG { proxy: true }`, connect talks to the executor
 * through the parent window (a `PostMessageWebSocket` and a proxied fetch, under the placeholder
 * origin `http://proxy`), and `core.baseUrl` names nothing reachable: a client built from it alone
 * would dial a default executor instead of the parent's.
 *
 * connect exposes no client factory, so the proxy is read off the core, where it keeps it. Its
 * options are the constructor options this SDK takes (`webSocketImpl`, `fetchImpl`).
 */
export function sessionClient(core: ConnectCoreLike): Ad4mClient {
  const proxy = (core as ConnectCoreLike & { proxy?: ConnectProxy }).proxy;
  return proxy ? new Ad4mClient(proxy.baseUrl, core.token, proxy.options) : new Ad4mClient(core.baseUrl, core.token);
}
