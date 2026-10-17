/**
 * The call services the host lends feature modules, over the backend's `CallPort`.
 *
 * The port takes a dataset on every operation; the call module asks without one. Choosing the
 * dataset is the host's job, and this is where it is done:
 *
 * - **A session** is built in the call's own space when the module names it (`datasetUri`), and in
 *   the space on screen when it does not. A named space that is not joined is refused, never
 *   swapped for the one on screen: a participant following a topology switch from another space
 *   reconnected into a call nobody was in that way.
 * - **The policy** is the space on screen's — what space settings configure.
 *
 * The port is read on every call rather than captured, because the backend connects after the host
 * builds these. A backend without one refuses a session and reports nothing to configure.
 */
import type { CallPort, DatasetHandle } from '@we/backend-shared';

import type { ModuleHostServices } from './registries/moduleHostServices';

export interface CallServicesDeps {
  /** The backend's call port, or nothing where it has none or has not connected. */
  port: () => CallPort | undefined;
  /** The dataset on screen. */
  current: () => DatasetHandle | null;
  /** A joined dataset by its shared uri. */
  byUri: (sharedUri: string) => DatasetHandle | null;
}

export type CallServices = Required<
  Pick<ModuleHostServices, 'createCallBackend' | 'getCallConfig' | 'setCallConfig' | 'callConfigSupported'>
>;

export function createCallServices({ port, current, byUri }: CallServicesDeps): CallServices {
  const requirePort = (): CallPort => {
    const found = port();
    if (!found) throw new Error('call: this backend cannot run calls');
    return found;
  };

  const requireCurrent = (): DatasetHandle => {
    const dataset = current();
    if (!dataset) throw new Error('call: no active dataset');
    return dataset;
  };

  return {
    async createCallBackend(callId, options) {
      const calls = requirePort();
      const named = options?.datasetUri;
      const dataset = named ? byUri(named) : current();
      if (!dataset) {
        throw new Error(named ? `call: the call's space (${named}) is not joined` : 'call: no active dataset');
      }
      return calls.createSession(dataset, callId, {
        ...(options?.iceServers ? { iceServers: options.iceServers } : {}),
        ...(options?.topology ? { topology: options.topology } : {}),
      });
    },
    getCallConfig: async () => requirePort().config(requireCurrent()),
    setCallConfig: async (config) => requirePort().setConfig(requireCurrent(), config),
    callConfigSupported() {
      const dataset = current();
      return Boolean(dataset && port()?.configurable(dataset));
    },
  };
}
