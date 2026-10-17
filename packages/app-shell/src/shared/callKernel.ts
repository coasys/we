/**
 * The `call` kernel, built over the backend's `CallPort`.
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
 * builds this. A backend without one is not available, which sends the call module to its own mesh.
 */
import type { CallPort, DatasetHandle } from '@we/backend-shared';
import type { CallKernel, CallSession } from '@we/module-shared';

export interface CallKernelDeps {
  /** The backend's call port, or nothing where it has none or has not connected. */
  port: () => CallPort | undefined;
  /** The dataset on screen. */
  current: () => DatasetHandle | null;
  /** A joined dataset by its shared uri. */
  byUri: (sharedUri: string) => DatasetHandle | null;
}

export function createCallKernel({ port, current, byUri }: CallKernelDeps): CallKernel {
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
    available: () => port() !== undefined,
    async session(callId, request) {
      const calls = requirePort();
      const named = request?.datasetUri;
      const dataset = named ? byUri(named) : current();
      if (!dataset)
        throw new Error(named ? `call: the call's space (${named}) is not joined` : 'call: no active dataset');
      // The backend's own session, which satisfies `CallSession` structurally — the one place the
      // contract's `unknown` is read as the module's shape. See `@we/module-shared`'s `call.ts`.
      return (await calls.createSession(dataset, callId, {
        ...(request?.iceServers ? { iceServers: request.iceServers } : {}),
        ...(request?.topology ? { topology: request.topology } : {}),
      })) as CallSession;
    },
    config: async () => requirePort().config(requireCurrent()),
    setConfig: async (config) => requirePort().setConfig(requireCurrent(), config),
    configurable() {
      const dataset = current();
      return Boolean(dataset && port()?.configurable(dataset));
    },
  };
}
