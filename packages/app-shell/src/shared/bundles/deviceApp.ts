/**
 * The app this device last ran, kept so the sign-in screen can be that app's.
 *
 * A cartridge (a bundle with an app) can rename WE, give it its own mark and themes, and draw its own
 * sign-in screen. All of that lives in the agent's library and settings — which cannot be read until
 * somebody has signed in, and the boot snapshot (`bootSnapshot.ts`) is kept per agent for the same
 * reason. So a person who installed an app from a file would have signed in to WE's screen, and only
 * then seen the app they chose.
 *
 * This is the device's memory of it: the app's brand, its sign-in screen and its themes, written
 * whenever the app in use is known, read at boot before anything else has answered. Device-wide
 * rather than per agent, because nobody is signed in when it is read — the same reason the default
 * theme is kept in localStorage (`THEME_KEY` in the theme store). It holds what an app *looks like*,
 * never anything about the agent.
 *
 * ## Why this is safe to read back
 *
 * The sign-in screen in it goes through the same acceptance, at the same tier, as the app it came
 * with, and must still place the host's `CredentialField`; anything edited in by hand is worth no more
 * than a template that could have been installed. Safe mode ignores it and draws WE's own. And it is a
 * cache: losing it costs one sign-in on WE's screen, nothing more.
 */
import type { ThemeData } from '@we/entities';
import type { BundleBrand, SchemaNode } from '@we/schema-shared';

const KEY = 'we:device-app';
const VERSION = 1;

export interface DeviceApp {
  v: typeof VERSION;
  /** The bundle whose app this was, or `''` for WE's own — which is an answer, not an absence. */
  bundleId: string;
  brand?: BundleBrand;
  bootScreen?: SchemaNode;
  /** The themes the app offers, whole, so the sign-in screen can wear one nobody has loaded yet. */
  themes?: ThemeData[];
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readDeviceApp(): DeviceApp | null {
  const raw = storage()?.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeviceApp>;
    if (parsed.v !== VERSION || typeof parsed.bundleId !== 'string') return null;
    return parsed as DeviceApp;
  } catch {
    return null;
  }
}

/** Keep what the app in use looks like for the next boot. Written only when it changed. */
export function writeDeviceApp(app: Omit<DeviceApp, 'v'>): void {
  const store = storage();
  if (!store) return;
  const next = JSON.stringify({ v: VERSION, ...app });
  if (store.getItem(KEY) === next) return;
  try {
    store.setItem(KEY, next);
  } catch {
    // Full or refused: the next boot draws WE's sign-in screen, which is what it did before this.
  }
}

export function forgetDeviceApp(): void {
  storage()?.removeItem(KEY);
}
