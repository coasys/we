import type { SchemaNode } from '@we/schema-shared';

/**
 * A labelled block of backend administration, with a heading and a refresh control.
 *
 * The shape every runtime-settings section shares. They all render a list the *backend* owns rather
 * than one WE writes, so a manual refresh is not a convenience here — nothing in the app changes
 * these, and there is no subscription to tell us when something else did.
 *
 * WE-domain rather than layout: the spinner reads `runtimeStore.loading`, so a deployment without
 * that store gets a control that never resolves.
 */
export interface AdminSectionOptions {
  title: string;
  icon: string;
  /** The store action a manual refresh calls — `'runtimeStore.loadTrustedAgents'`. */
  refresh: string;
  children: SchemaNode[];
}

export function adminSection(opts: AdminSectionOptions): SchemaNode {
  const { title, icon, refresh, children } = opts;
  return {
    type: 'Column',
    props: { gap: '300' },
    children: [
      {
        type: 'Row',
        props: { gap: '300', ay: 'center', ax: 'between' },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center' },
            children: [
              { type: 'we-icon', props: { name: icon, color: 'neutral-600' } },
              { type: 'we-text', props: { fontWeight: 'semibold' }, children: [title] },
            ],
          },
          {
            type: 'we-button',
            props: {
              variant: 'ghost',
              size: 'sm',
              onClick: { $action: refresh },
              loading: { $store: 'runtimeStore.loading' },
            },
            children: [{ type: 'we-icon', props: { name: 'arrows-clockwise' } }],
          },
        ],
      },
      ...children,
    ],
  };
}
