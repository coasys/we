import type { SchemaNode } from '@we/schema-shared';

/**
 * A labelled block of backend administration, with a heading and a refresh control.
 *
 * The shape every runtime-settings section shares. They all render a list the *backend* owns rather
 * than one WE writes, so a manual refresh is not a convenience here — nothing in the app changes
 * these, and there is no subscription to tell us when something else did.
 *
 * WE-domain rather than layout: the spinner reads `runtimeStore.pending` for the refresh action's
 * name, so a deployment without that store gets a control that never resolves.
 */
export interface AdminSectionOptions {
  title: string;
  icon: string;
  /**
   * The store action a manual refresh calls — `'runtimeStore.loadTrustedAgents'`.
   *
   * Omit it for a section that shows no backend list of its own, only controls. An icon in the
   * heading with nothing to reload either does nothing or does something its placement does not say.
   */
  refresh?: string;
  children: SchemaNode[];
}

export function adminSection(opts: AdminSectionOptions): SchemaNode {
  const { title, icon, refresh, children } = opts;
  const heading: SchemaNode = {
    type: 'Row',
    props: { gap: '200', ay: 'center' },
    children: [
      { type: 'we-icon', props: { name: icon, color: 'text-muted' } },
      { type: 'we-text', props: { fontWeight: 'semibold' }, children: [title] },
    ],
  };
  return {
    type: 'Column',
    props: { gap: '300' },
    children: [
      {
        type: 'Row',
        props: { gap: '300', ay: 'center', ax: 'between' },
        children: refresh
          ? [
              heading,
              {
                type: 'we-button',
                props: {
                  variant: 'ghost',
                  size: 'sm',
                  onClick: { $action: refresh },
                  // Spins for this section's own reload. It read the store-wide flag once, and every
                  // heading on the page spun whenever anything anywhere was fetching.
                  loading: { $: `'${refresh.slice(refresh.lastIndexOf('.') + 1)}' in runtimeStore.pending` },
                },
                children: [{ type: 'we-icon', props: { name: 'arrows-clockwise' } }],
              },
            ]
          : [heading],
      },
      ...children,
    ],
  };
}
