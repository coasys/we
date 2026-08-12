import { createDesktopPlatform } from '@we/app-shell/shared';

// Import auto-generated port mapping
import portMap from '../../electron/seed-port-map.json';

/**
 * The registry lives in the main process — it has to, because the data path is
 * needed to spawn the executor before any renderer exists. Everything below is
 * the IPC surface over it; the adapter shape itself is shared with Tauri via
 * createDesktopPlatform.
 */
export const electronPlatform = createDesktopPlatform({
  platform: 'electron',
  portMap,
  // Vite's built-in DEV flag — true in dev server, false in production build.
  isDevelopment: () => import.meta.env.DEV,
  accounts: {
    list: () => window.electron.listAccounts(),
    create: () => window.electron.createAccount(),
    setDisplay: (id, display) => window.electron.setAccountDisplay(id, display),
    select: (id) => window.electron.selectAccount(id),
    remove: (id) => window.electron.removeAccount(id),
    applySelection: () => window.electron.applyAccountSelection(),
  },
  // The executor is a child process here, so restarting it leaves the window in place.
  executor: {
    getSettings: () => window.electron.getExecutorSettings(),
    setSettings: (settings) => window.electron.setExecutorSettings(settings),
    restart: () => window.electron.restartExecutor(),
    chooseFile: (options) => window.electron.chooseFile(options),
  },
});
