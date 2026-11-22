/** What the platform's registry says of an app. */
export interface RegisteredApp {
  appId: string;
  name: string;
  origins: string[];
  firstParty: boolean;
}

export type Registry = (appId: string) => Promise<RegisteredApp | undefined>;

/** The registry at `{platform}/v1/connect/apps/{appId}`; an unknown app or a failed read is `undefined`. */
export function platformRegistry(platform: string, http: typeof fetch = (...args) => fetch(...args)): Registry {
  return async (appId) => {
    try {
      const response = await http(`${platform}/v1/connect/apps/${encodeURIComponent(appId)}`);
      if (!response.ok) return undefined;
      const app = (await response.json()) as RegisteredApp;
      return Array.isArray(app.origins) ? app : undefined;
    } catch {
      return undefined;
    }
  };
}
