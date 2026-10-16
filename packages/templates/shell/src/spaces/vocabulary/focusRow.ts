import type { SchemaNode } from '@we/schema-shared';

/**
 * One vocabulary record's row, findable and marked when the settings were opened about it.
 *
 * "Edit in Vocabulary" on a task state opened the tab and left the reader to find the state in it.
 * The panel now scrolls to the element named `vocab-<id>` and this row tints while it is the one asked
 * about (`shellStore.spaceSettingsFocus`) — the same act as a search result opening on its line.
 *
 * `as` is the name the row's loop binds; its record's `id` is what both read. A native element holds
 * the DOM id, because a component's props are assigned as properties and an `id` there would not reach
 * the element `getElementById` looks for.
 */
export function focusRow(as: string, row: SchemaNode, extra: Record<string, unknown> = {}): SchemaNode {
  return {
    type: 'div',
    props: { id: { $: `'vocab-' + ${as}.id` }, style: { width: '100%' }, ...extra },
    children: [
      {
        type: 'Column',
        props: {
          width: '100%',
          r: '300',
          bg: { $: `shellStore.spaceSettingsFocus == ${as}.id ? 'accent-muted' : 'transparent'` },
          transition: 'background-color 300 ease-in-out',
        },
        children: [row],
      },
    ],
  };
}
