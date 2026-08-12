import { invoke } from '@tauri-apps/api/core';
import type { BackendConnector } from '@we/app-shell/shared';
import { createLocalAd4mConnector } from '@we/backend-ad4m';

/** Only the transport is this platform's own: connection details come from Rust commands. */
export const ad4mConnector: BackendConnector = createLocalAd4mConnector(async () => ({
  port: await invoke<number>('get_port'),
  token: await invoke<string>('request_credential'),
}));
