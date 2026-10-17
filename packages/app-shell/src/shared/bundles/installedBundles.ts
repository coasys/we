/**
 * What each installed bundle wrote — `AgentSettings.installedBundles`, as JSON.
 *
 * One entry per bundle, keyed by its id, replaced whole by a later install of the same bundle. It
 * names every piece the install wrote under the ids they were written under, so the bundle can be
 * removed with everything it brought and a later version recognised as an update; it carries the
 * display policy, so how an app shows spaces is a property of the app in use rather than a setting;
 * and the record types it brings, so a space can be set up for it later.
 */
import type { BundleRecordType } from '@we/schema-shared';

import type { BundlePieces } from './bundlePieces';
import type { BundleGrant } from './consent';

export interface InstalledBundle {
  id: string;
  version: string;
  name: string;
  icon: string;
  /** Where it came from. Only files today; the marketplace will carry an author. */
  from: 'file';
  /** ISO time of the install. */
  at: string;
  app?: string;
  /** Every space template and section it wrote, by id. */
  templates: string[];
  theme?: string;
  /** Sections, by id — what setting up a space switches on. */
  sections: string[];
  /** Kept whole: a space set up later needs the definitions, and the file is gone by then. */
  recordTypes: BundleRecordType[];
  display?: { spaces: 'ours' | 'theirs'; template?: string };
  /** What the person agreed to when installing it — what a later version is compared against. */
  granted?: BundleGrant;
}

export function readInstalledBundles(raw: string | undefined | null): InstalledBundle[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed.filter((entry) => entry && typeof entry.id === 'string') as InstalledBundle[])
      : [];
  } catch {
    return [];
  }
}

/** The list with this bundle's entry put in, replacing any for the same bundle. */
export function withInstalled(list: readonly InstalledBundle[], entry: InstalledBundle): InstalledBundle[] {
  return [...list.filter((existing) => existing.id !== entry.id), entry];
}

export function withoutInstalled(list: readonly InstalledBundle[], id: string): InstalledBundle[] {
  return list.filter((existing) => existing.id !== id);
}

/** The entry an install of these pieces writes. */
export function installedEntry(
  pieces: BundlePieces,
  meta: { name: string; icon: string; at: string; granted?: BundleGrant },
): InstalledBundle {
  return {
    id: pieces.bundleId,
    version: pieces.version,
    name: meta.name,
    icon: meta.icon,
    from: 'file',
    at: meta.at,
    ...(pieces.app ? { app: pieces.app.id } : {}),
    templates: [...pieces.shells, ...pieces.sections].map((template) => template.id),
    ...(pieces.theme ? { theme: pieces.theme.id } : {}),
    sections: pieces.sections.map((section) => section.id),
    recordTypes: pieces.recordTypes,
    ...(pieces.display ? { display: pieces.display } : {}),
    ...(meta.granted ? { granted: meta.granted } : {}),
  };
}

/** An installed bundle as the display rule reads it — see `display.ts`. */
export function displaySourceOf(entry: InstalledBundle): {
  app?: { id: string };
  display?: InstalledBundle['display'];
} {
  return { ...(entry.app ? { app: { id: entry.app } } : {}), ...(entry.display ? { display: entry.display } : {}) };
}
