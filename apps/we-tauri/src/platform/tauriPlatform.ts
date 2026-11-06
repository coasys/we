import { invoke } from '@tauri-apps/api/core';
import type { Account, ExecutorSettings } from '@we/app-shell/shared';
import { createDesktopPlatform } from '@we/app-shell/shared';

import portMap from '../generated/seed-port-map.json';

/**
 * The registry lives on the Rust side — it has to, because the data path is
 * needed to configure the executor before any window exists. Everything below
 * is the command surface over it; the adapter shape itself is shared with
 * Electron via createDesktopPlatform.
 */
export const tauriPlatform = createDesktopPlatform({
  platform: 'tauri',
  portMap,
  isDevelopment: () => import.meta.env.DEV,
  accounts: {
    list: () => invoke<Account[]>('list_accounts'),
    create: () => invoke<Account>('create_account'),
    setDisplay: (id, display) => invoke<void>('set_account_display', { id, display }),
    select: (id) => invoke<void>('select_account', { id }),
    remove: (id) => invoke<void>('remove_account', { id }),
    applySelection: () => invoke<void>('apply_account_selection'),
  },
  // The executor runs in this process, so restarting it means relaunching the app.
  executor: {
    getSettings: () => invoke<ExecutorSettings>('get_executor_settings'),
    setSettings: (settings) => invoke<ExecutorSettings>('set_executor_settings', { settings }),
    restart: () => invoke<void>('restart_executor'),
    chooseFile: (options) => invoke<string | null>('choose_file', options),
  },
});
