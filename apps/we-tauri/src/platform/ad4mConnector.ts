import { invoke } from '@tauri-apps/api/core';
import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';
import { createAd4mBackendPorts } from '@we/backend-ad4m';

import { buildAd4mClientWithApollo } from '../utils/apolloClient';

export const ad4mConnector: BackendConnector = {
  async initialize(ctx): Promise<BackendInitResult> {
    // Get connection details from the Tauri backend
    const port = await invoke<number>('get_port');
    const token = await invoke<string>('request_credential');

    // The Tauri process spawns the executor alongside the window — give it a moment to come up
    // before opening connections against it. This wait is a property of how THIS platform starts
    // its backend, which is why it lives here and not in the shell.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { client } = await buildAd4mClientWithApollo(port, token);

    return {
      client,
      ports: createAd4mBackendPorts(client, ctx),
      // Forwarded to hosted app iframes by the embed bridge.
      connection: { port, token },
    };
  },
};
