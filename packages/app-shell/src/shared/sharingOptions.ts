import type { SharingOption } from '@we/backend-shared';

/** The server picker's value for "a server not in the list", whose address is typed in. */
export const CUSTOM_SERVER = 'custom';

/** One entry in the create-space picker for how a shared space syncs. */
export interface SharingPickerOption {
  label: string;
  value: string;
  icon: string;
  /** One sentence on what choosing it means, shown under the picker while it is selected. */
  description: string;
  /**
   * For a server option, the picker for which server: the backend's suggestions, its default first
   * and named by host, then one for typing in another (value {@link CUSTOM_SERVER}). Empty for a
   * peer-to-peer option.
   */
  servers: { label: string; value: string }[];
}

const ICONS: Record<SharingOption['kind'], string> = {
  'peer-to-peer': 'share-network',
  server: 'hard-drives',
};

/** The server's host, which is what a person recognises — the scheme and path say nothing to them. */
function serverHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Picker entries for the ways a backend can share a space, in the backend's order (its default
 * first).
 *
 * Labelled by how a space syncs rather than by the option's own name, which is a package name
 * nobody choosing one would recognise. The technical name only appears in a label when two
 * options would otherwise read the same. Which server a server option syncs through is a second
 * choice, made in its `servers` picker, so the label does not name one.
 */
export function sharingPickerOptions(templates: readonly SharingOption[]): SharingPickerOption[] {
  const baseLabel = (t: SharingOption) => (t.kind === 'server' ? 'Server' : 'Peer-to-peer');
  const counts = new Map<string, number>();
  for (const t of templates) counts.set(baseLabel(t), (counts.get(baseLabel(t)) ?? 0) + 1);

  return templates.map((t) => {
    const base = baseLabel(t);
    return {
      value: t.id,
      label: (counts.get(base) ?? 0) > 1 ? `${base} · ${t.name}` : base,
      icon: ICONS[t.kind],
      description:
        t.kind === 'server'
          ? "Syncs through a server, so members stay in sync without being online at the same time. Content is encrypted on your device, so the server can't read it."
          : "Members' devices sync directly with each other, with no server in between. Changes reach others when they're online.",
      servers:
        t.kind === 'server'
          ? [
              ...(t.servers ?? []).map((url) => ({ label: serverHost(url), value: url })),
              { label: 'Custom…', value: CUSTOM_SERVER },
            ]
          : [],
    };
  });
}
