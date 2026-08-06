import type { SchemaNode } from '@we/schema-shared';

/**
 * A labelled block with a heading and a refresh control.
 *
 * The shape every backend-administration section shares. They all render a list the backend owns
 * rather than one WE writes, so a manual refresh is not a convenience here — nothing in the app
 * changes these, and there is no subscription to tell us when something else did.
 */
export function section(title: string, icon: string, refresh: string, children: SchemaNode[]): SchemaNode {
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

/** The line every one of these sections shows in place of a list it has nothing for. */
export function emptyNote(text: string): SchemaNode {
  return {
    type: 'we-text',
    props: { variant: 'footnote', color: 'neutral-500', italic: true },
    children: [text],
  };
}
