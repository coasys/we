/**
 * Names and origins in the local world.
 *
 * Each service of a world has the name it has in production and the name it has in the local
 * world, in the reserved `.test` top-level domain. Two ports on `localhost` are one site, so a check
 * of origins, storage partitions or frame rules would pass there for the wrong reason; the local
 * names keep the web app and the auth domain two sites, as in production.
 *
 * The local world serves only the services its scenarios need. Each started service is entered here
 * with the address it listens on, and every endpoint a scenario reads comes from here. A world
 * refuses any endpoint that names a production service, so no endpoint a scenario reads points at
 * production. This checks names only: it does not stop a started process from calling out itself.
 */

export type Service = 'webApp' | 'authDomain' | 'platformApi' | 'store' | 'linkServer' | 'coasysCloud' | 'unyt';

/** The local name of each service, and its production name. */
export const NAMES: Record<Service, { local: string; production: string }> = {
  webApp: { local: 'app.coasys.test', production: 'app.coasys.org' },
  authDomain: { local: 'coasys-id.test', production: 'coasys.id' },
  platformApi: { local: 'api.coasys.test', production: 'api.coasys.org' },
  store: { local: 'store.coasys.test', production: 'store.coasys.org' },
  linkServer: { local: 'link.coasys.test', production: 'link.coasys.org' },
  coasysCloud: { local: 'cloud.coasys.test', production: 'cloud.coasys.org' },
  unyt: { local: 'unyt.coasys.test', production: '' },
};

/** The local name of a community host or a server a person runs. */
export function hostName(name: string): string {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`a host name is lowercase letters, digits and dashes: ${name}`);
  return `host-${name}.test`;
}

const PRODUCTION = Object.values(NAMES)
  .map((n) => n.production)
  .filter(Boolean);

/** Whether a URL names a production service. */
export function isProduction(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return PRODUCTION.some((p) => host === p || host.endsWith(`.${p}`));
}

/** One service a world has started: its local name and the address it listens on. */
export interface Endpoint {
  service: Service | string;
  /** The `.test` name the service has in this world. */
  name: string;
  /** Where it listens. */
  url: string;
}

/** The endpoints of one world, which refuse a production address. */
export class Endpoints {
  private readonly byService = new Map<string, Endpoint>();

  add(service: Service | string, url: string): Endpoint {
    if (isProduction(url)) throw new Error(`a world never uses a production service: ${service} at ${url}`);
    const name = service in NAMES ? NAMES[service as Service].local : hostName(service);
    const endpoint = { service, name, url };
    this.byService.set(service, endpoint);
    return endpoint;
  }

  get(service: Service | string): Endpoint {
    const endpoint = this.byService.get(service);
    if (!endpoint) throw new Error(`this world has no ${service}`);
    return endpoint;
  }

  all(): Endpoint[] {
    return [...this.byService.values()];
  }
}
