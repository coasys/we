/**
 * Setting the space's avatar or cover image from a picture the person chose: the handler an
 * `EditableImage`'s `onImageChange` takes.
 *
 * Two steps, because they are two different kinds of work. Making the picture into what the record
 * stores — compressed, an avatar sized for one — is the host's, and stores nothing. Writing it is the
 * space's operation, so the picture is drawn the moment it is invoked, on every surface showing the
 * space, and a refusal is said as the operation's.
 */
import type { SchemaProp } from '@we/schema-shared';

export const spaceImageChange = (field: 'avatar' | 'coverImage'): SchemaProp => ({
  $invoke: 'spaceStore.prepareSpaceImage',
  args: [field, { $: 'arg' }],
  onSuccess: [
    {
      $invoke: 'ops.core.setSpaceImage',
      args: [{ $: `{ space: spaceStore.currentSpace.id, field: '${field}', image: result }` }],
    },
  ],
});
