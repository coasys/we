import type { Ad4mClient } from '@coasys/ad4m';
import { invoke } from '@tauri-apps/api/core';
import type { BackendConnectionDetails, BackendConnector } from '@we/app-shell/shared';

import { buildAd4mClientWithApollo } from '../utils/apolloClient';

export const ad4mConnector: BackendConnector = {
  async connect(): Promise<Ad4mClient> {
    // Get connection details from Tauri backend
    const port = await invoke<number>('get_port');
    const token = await invoke<string>('request_credential');

    // Build Apollo-based Ad4mClient
    const { client } = await buildAd4mClientWithApollo(port, token);

    return client;
  },

  async connectionDetails(): Promise<BackendConnectionDetails> {
    // Desktop platforms expose connection details for iframe communication
    const port = await invoke<number>('get_port');
    const token = await invoke<string>('request_credential');

    return { port, token };
  },
};
