/**
 * Where this build of the web app sends people and requests: one object, chosen at build time by
 * `COASYS_ENV` (`production`, or `staging` for `dev` and for pull request previews) from
 * `config/<env>.json`. The app's own origin is here too, because Connect's frame answers only to the
 * origin the platform registry lists for the app, and a staging page must say it is staging.
 */
export interface AppEndpoints {
  /** This app's origin: the one the registry lists for `coasys-app`. */
  appOrigin: string;
  /** The auth domain: Connect's frame and popups. */
  identityOrigin: string;
  /** The platform API: the Connect app registry, the hosting index. */
  apiOrigin: string;
  /** The identity store. */
  storeOrigin: string;
}

/** The app id the platform registry knows this app by. */
export const APP_ID = 'coasys-app';

const FIELDS: Array<keyof AppEndpoints> = ['appOrigin', 'identityOrigin', 'apiOrigin', 'storeOrigin'];

/** The endpoints in `raw`, or an error naming the field that is not an https origin. */
export function parseEndpoints(raw: unknown): AppEndpoints {
  const object = (raw ?? {}) as Record<string, unknown>;
  for (const field of FIELDS) {
    const value = object[field];
    const origin = typeof value === 'string' && URL.canParse(value) ? new URL(value) : null;
    if (!origin || origin.protocol !== 'https:' || origin.origin !== value) {
      throw new Error(`endpoints.${field} must be an https origin, got ${JSON.stringify(value)}`);
    }
  }
  return object as unknown as AppEndpoints;
}

/** This build's endpoints, compiled in from the config file `COASYS_ENV` names. */
export const APP_ENDPOINTS: AppEndpoints = parseEndpoints(__APP_ENDPOINTS__);
