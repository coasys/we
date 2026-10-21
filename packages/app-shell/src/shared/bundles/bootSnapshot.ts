/**
 * What the first frame after a reload needs to draw the app somebody is in, kept on this device.
 *
 * The app, the space template its display policy opens spaces with, and the theme they name all
 * live in the agent's library and settings, which arrive seconds after the app has started drawing.
 * Until then the only app there is to draw is WE's, so a reload showed WE's chrome and WE's space
 * template and then swapped both. A snapshot of exactly those pieces is read at boot and stands in
 * for the library and the settings until they answer, and is then replaced by them.
 *
 * ## Why this is safe to read back
 *
 * It holds only what this agent already installed, and every template in it goes through the same
 * acceptance at the same tier as when it is read from the library — so a snapshot somebody edited is
 * worth no more than a template they could have put in the library. Safe mode ignores it, because
 * it draws WE's app and themes whatever the library holds. It is per agent: another account on the
 * same machine reads its own or none.
 *
 * ## Why `localStorage`
 *
 * It must be readable synchronously, before anything else has answered, which rules out the backend
 * and IndexedDB both. It is a cache: losing it costs one reload with the old flash, nothing more.
 */
import type { ThemeData } from '@we/entities';
import { type TemplateSchema, templateThemeIds } from '@we/schema-shared';

const KEY_PREFIX = 'we:boot-snapshot:';
const VERSION = 1;

export interface BootSnapshot {
  v: typeof VERSION;
  /** `AgentSettings.appTemplateId` as it last was, empty for WE's own. */
  appTemplateId: string;
  /** `AgentSettings.installedBundles` as it last was — what the display policy is read from. */
  installedBundles: string;
  /** The app in use when it is the agent's own, and every template the bundle it came in brought. */
  templates: TemplateSchema[];
  /** The themes those templates name. */
  themes: ThemeData[];
}

export interface BootSnapshotSource {
  appTemplateId: string;
  installedBundles: string;
  /** The agent's library, as loaded. */
  library: readonly TemplateSchema[];
  installedThemes: readonly ThemeData[];
}

/**
 * The pieces worth keeping: the app in use, if it is the agent's own, and the rest of the bundle it
 * came in — its space templates, which the display policy may open every space with, and its
 * sections, which those templates show. Nothing for WE's own app, which is built in.
 */
export function selectBootSnapshot(source: BootSnapshotSource): BootSnapshot {
  const app = source.appTemplateId ? source.library.find((t) => t.id === source.appTemplateId) : undefined;
  const bundle = app?.source?.bundle;
  const templates = source.library.filter(
    (t) => !t._fromSpace && (t === app || (bundle !== undefined && t.source?.bundle === bundle)),
  );
  const named = new Set(templates.flatMap((t) => templateThemeIds(t.meta)));
  return {
    v: VERSION,
    appTemplateId: source.appTemplateId,
    installedBundles: source.installedBundles,
    templates,
    themes: source.installedThemes.filter((theme) => named.has(theme.id)),
  };
}

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The snapshot for this agent, or null when there is none or it is not one this build can read. */
export function readBootSnapshot(did: string | undefined): BootSnapshot | null {
  const store = storage();
  if (!did || !store) return null;
  try {
    const parsed = JSON.parse(store.getItem(KEY_PREFIX + did) ?? 'null') as Partial<BootSnapshot> | null;
    if (
      !parsed ||
      parsed.v !== VERSION ||
      typeof parsed.appTemplateId !== 'string' ||
      typeof parsed.installedBundles !== 'string' ||
      !Array.isArray(parsed.templates) ||
      !Array.isArray(parsed.themes)
    )
      return null;
    return parsed as BootSnapshot;
  } catch {
    return null;
  }
}

/** Drop this agent's snapshot, so the next reload draws nothing early. */
export function forgetBootSnapshot(did: string | undefined): void {
  const store = storage();
  if (!did || !store) return;
  try {
    store.removeItem(KEY_PREFIX + did);
  } catch {
    // Refused: the snapshot is read back through the same acceptance as the library either way.
  }
}

/** Keep the snapshot for next time, or drop it when there is nothing in it worth drawing early. */
export function writeBootSnapshot(did: string | undefined, snapshot: BootSnapshot): void {
  const store = storage();
  if (!did || !store) return;
  try {
    if (!snapshot.appTemplateId && !snapshot.templates.length) store.removeItem(KEY_PREFIX + did);
    else store.setItem(KEY_PREFIX + did, JSON.stringify(snapshot));
  } catch (error) {
    // Full, or refused: the next reload flashes as it did before, which is all this cache is for.
    console.warn('Could not keep the app for the next reload', error);
  }
}
