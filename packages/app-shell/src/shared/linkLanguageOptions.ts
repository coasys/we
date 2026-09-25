import type { LinkLanguageTemplate } from '@we/backend-shared';

/** One entry in the create-space picker for how a shared space syncs. */
export interface LinkLanguageOption {
  label: string;
  value: string;
  icon: string;
  /** One sentence on what choosing it means, shown under the picker while it is selected. */
  description: string;
}

const ICONS: Record<LinkLanguageTemplate['kind'], string> = {
  'peer-to-peer': 'share-network',
  server: 'hard-drives',
};

/** The server's host, which is what a person recognises — the scheme and path say nothing to them. */
function serverHost(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Picker entries for the templates a backend offers, in the backend's order (its default first).
 *
 * Labelled by how a space syncs rather than by the template's own name, which is a package name
 * nobody choosing one would recognise. The technical name only appears in a label when two
 * templates would otherwise read the same.
 */
export function linkLanguageOptions(templates: readonly LinkLanguageTemplate[]): LinkLanguageOption[] {
  const baseLabel = (t: LinkLanguageTemplate) => {
    const host = serverHost(t.serverUrl);
    return t.kind === 'server' ? (host ? `Server (${host})` : 'Server') : 'Peer-to-peer';
  };
  const counts = new Map<string, number>();
  for (const t of templates) counts.set(baseLabel(t), (counts.get(baseLabel(t)) ?? 0) + 1);

  return templates.map((t) => {
    const base = baseLabel(t);
    const host = serverHost(t.serverUrl);
    return {
      value: t.address,
      label: (counts.get(base) ?? 0) > 1 ? `${base} · ${t.name}` : base,
      icon: ICONS[t.kind],
      description:
        t.kind === 'server'
          ? `Syncs through ${host || 'a server'}, so members stay in sync without being online at the same time. Content is encrypted on your device, so the server can't read it.`
          : "Members' devices sync directly with each other, with no server in between. Changes reach others when they're online.",
    };
  });
}
