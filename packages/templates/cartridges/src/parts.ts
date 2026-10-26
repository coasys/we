import type { SchemaNode } from '@we/schema-shared';

/**
 * Making one, from the section that lists them. The form is the record store's, derived from the
 * shape, so a sighting's place is pinned on a map and its photo cropped in place with nothing
 * written here — and each section carries the modal, since a section is all a space may have.
 */
export const addButton = (label: string, entity: string, icon: string): SchemaNode => ({
  type: 'we-button',
  props: {
    variant: 'solid',
    size: 'sm',
    flexShrink: '0',
    onClick: { $invoke: 'recordStore.openRecordForm', args: [entity] },
  },
  children: [
    { type: 'we-icon', props: { name: icon } },
    { type: 'we-text', children: [label] },
  ],
});
