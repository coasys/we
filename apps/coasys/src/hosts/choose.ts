import type { BackendConnector, BaseHost } from '@we/app-shell/shared';
import type { DeviceKeyPlugin } from '@we/app-web/platform/deviceKey';

import { phoneBaseHost } from './phone';
import { webBaseHost } from './web';

/**
 * The host this page runs on: the phone's, where the `DeviceKey` plugin answers (inside the phone
 * app), and the browser's everywhere else.
 */
export function chooseHost(parts: { plugin: DeviceKeyPlugin | null; fallback: BackendConnector }): BaseHost {
  return parts.plugin ? phoneBaseHost({ plugin: parts.plugin, fallback: parts.fallback }) : webBaseHost(parts.fallback);
}
