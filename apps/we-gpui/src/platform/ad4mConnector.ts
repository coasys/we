import type { BackendConnector } from '@we/app-shell/shared';
import { createLocalAd4mConnector } from '@we/backend-ad4m';
import weSeed from '@we/seed-file';

import { invoke } from './bridge';
import { gpuiIdentityHost } from './identityHost';

/** Only the transport is this platform's own: the port and credential come from the shell. */
export const ad4mConnector: BackendConnector = createLocalAd4mConnector(
  async () => ({
    port: await invoke<number>('get_port'),
    token: await invoke<string>('request_credential'),
  }),
  { linkServerUrl: (weSeed.ad4m as { linkServerUrl?: string }).linkServerUrl, custody: gpuiIdentityHost },
);
