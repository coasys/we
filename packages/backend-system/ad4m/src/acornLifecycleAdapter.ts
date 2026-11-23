/**
 * The AD4M `acornLifecycle` port — `perspective.mount`/`mounts`/`unmount`,
 * `language.applyTemplateLocal` and `expression.interact`, as the neutral
 * {@link AcornLifecyclePort}.
 *
 * All five calls ride the session's own `Ad4mClient`. On the a9 pin (`667d43e`)
 * the SDK carried none of the mount/template methods, so the first four went
 * over a second, hand-rolled WebSocket on the same connection — bounded,
 * session-keyed and disposed with it. The pin now carries
 * `PerspectiveClient.mount`/`mounts`/`unmount` and
 * `LanguageClient.applyTemplateLocal` natively, and this port is the collapse
 * the old docblock scheduled: thin delegates, no second transport.
 */
import type { Ad4mClient } from '@coasys/ad4m';
import { InteractionCall } from '@coasys/ad4m';
import type { AcornLifecyclePort } from '@we/backend-shared';

export function createAd4mAcornLifecycle(backendClient: unknown): AcornLifecyclePort {
  const client = backendClient as Ad4mClient;

  return {
    applyTemplateLocal: (sourceLanguageHash, templateData) =>
      // `applyTemplateLocal` stringifies `templateData` itself — the port hands
      // the record over and the wire shape stays the RPC's own.
      client.languages.applyTemplateLocal(sourceLanguageHash, templateData),
    mount: (datasetId, languageAddress) => client.perspective.mount(datasetId, languageAddress),
    mounts: (datasetId) => client.perspective.mounts(datasetId),
    unmount: (datasetId, languageAddress) => client.perspective.unmount(datasetId, languageAddress),
    interact: async (url, callSpec) => {
      const result = await client.expression.interact(
        url,
        new InteractionCall(callSpec.name, callSpec.parameters ?? {}),
      );
      if (typeof result !== 'string') return result;
      try {
        return JSON.parse(result) as unknown;
      } catch {
        return result;
      }
    },
  };
}
