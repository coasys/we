import type { Account, ExecutorSettings } from '@we/app-shell/shared';
import { createDesktopPlatform } from '@we/app-shell/shared';

import { invoke } from './bridge';

/**
 * The same command surface as the Tauri app's adapter, over the GPUI shell's bridge. The registry
 * lives on the Rust side, as it does there.
 *
 * Unlike Tauri, applying an account or restarting the executor does not relaunch the app: the
 * executor is a child process here, so the shell restarts it and reloads this page.
 */
export const gpuiPlatform = createDesktopPlatform({
  platform: 'gpui',
  // This shell serves no seed apps yet (WE's seed lists none); the other desktop shells generate this.
  portMap: {},
  isDevelopment: () => import.meta.env.DEV,
  accounts: {
    list: () => invoke<Account[]>('list_accounts'),
    create: () => invoke<Account>('create_account'),
    setDisplay: (id, display) => invoke<void>('set_account_display', { id, display }),
    select: (id) => invoke<void>('select_account', { id }),
    remove: (id) => invoke<void>('remove_account', { id }),
    applySelection: () => invoke<void>('apply_account_selection'),
  },
  executor: {
    getSettings: () => invoke<ExecutorSettings>('get_executor_settings'),
    setSettings: (settings) => invoke<ExecutorSettings>('set_executor_settings', { settings }),
    restart: () => invoke<void>('restart_executor'),
    chooseFile: (options) => invoke<string | null>('choose_file', { ...options }),
  },
});
