/**
 * The page's side of the GPUI shell's IPC bridge (`native/src/bridge.rs`).
 *
 * The shell installs `window.__WE_GPUI__` in the main frame before any page script runs, holding
 * this window's nonce in a closure: `invoke` posts a command and resolves with the shell's answer,
 * `listen` subscribes to events the shell emits. The same two calls the Tauri app makes through
 * `@tauri-apps/api`, so the adapters around them are the Tauri ones with the import swapped.
 */

export interface GpuiEvent<T> {
  event: string;
  payload: T;
}

export interface GpuiBridge {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: string, handler: (event: GpuiEvent<unknown>) => void): () => void;
}

declare global {
  interface Window {
    __WE_GPUI__?: GpuiBridge;
  }
}

/** The bridge, or a clear error when this page is not running in the GPUI shell. */
export function bridge(scope: { __WE_GPUI__?: GpuiBridge } = globalThis as { __WE_GPUI__?: GpuiBridge }): GpuiBridge {
  const found = scope.__WE_GPUI__;
  if (!found) {
    throw new Error('Not running in the WE GPUI shell: window.__WE_GPUI__ is missing');
  }
  return found;
}

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return bridge().invoke(cmd, args) as Promise<T>;
}

export function listen<T>(event: string, handler: (event: GpuiEvent<T>) => void): () => void {
  return bridge().listen(event, handler as (event: GpuiEvent<unknown>) => void);
}
