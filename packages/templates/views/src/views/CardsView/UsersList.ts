import type { SchemaNode } from '@we/schema-shared';
import { cardList, cardShell, emptyState, statChip } from '@we/template-kit';

export const usersList: SchemaNode = cardList({
  // The roster is already in the store, so this list is filtered in place rather than queried —
  // and its placeholder needs no fade-in delay, since "no members" is known on the first frame.
  items: {
    $filter: {
      items: { $store: 'spaceStore.members' },
      // `name` is the assembled display name (first + last, falling back to the
      // handle), so one branch covers both name parts; the handle branch covers
      // @handle searches for members who also have a real name. Bio is left out
      // deliberately: this is a people search, and matching a stray word deep in
      // a bio surfaces people who don't look like matches. One more OR branch if
      // that call changes.
      where: {
        OR: [{ name: { contains: { $local: 'searchText' } } }, { handle: { contains: { $local: 'searchText' } } }],
      },
    },
  },
  as: 'user',
  empty: emptyState({ icon: 'user', label: 'members', searchable: true, delay: 0 }),
  children: [
    cardShell({
      // Mirrors the spaces card: cover image when there is one, a lg avatar + name
      // header, then detail chips. A created/joined date is deliberately absent —
      // a member's profile summary carries no such field (unlike a Space model),
      // so there is nothing truthful to put in that chip.
      header: [
        {
          type: '$if',
          props: {
            condition: '$user.coverImage',
            then: {
              type: 'we-image',
              props: { src: '$user.coverImage', width: '100%', height: '120px', fit: 'cover', r: '400' },
            },
          },
        },
        {
          type: 'Row',
          props: { ay: 'center', gap: '300' },
          children: [
            {
              type: 'we-avatar',
              // `hash` as well as `image`, never instead: a member whose profile
              // hasn't arrived still gets a stable, distinct generated face.
              props: { image: '$user.avatar', hash: '$user.did', initials: '$user.name', size: 'lg', shadow: 'md' },
            },
            {
              type: 'Column',
              props: { gap: '100', flex: '1' },
              children: [
                { type: 'we-text', props: { variant: 'heading-sm' }, children: ['$user.name'] },
                {
                  type: '$if',
                  props: {
                    condition: '$user.handle',
                    then: {
                      type: 'we-text',
                      props: { variant: 'label' },
                      children: [{ $concat: ['@', '$user.handle'] }],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
      body: [
        {
          type: '$if',
          props: {
            condition: '$user.bio',
            then: { type: 'we-text', props: { color: 'text-muted' }, children: ['$user.bio'] },
          },
        },
        {
          type: '$if',
          props: {
            // Gated on city, not the location object: a lat/lng-only location (reverse
            // geocoding off) has nothing readable to show, and would render ", ".
            condition: '$user.location.city',
            then: {
              type: 'Row',
              props: { gap: '500', ay: 'center', wrap: true },
              children: [
                statChip({
                  icon: 'map-pin',
                  label: 'Location',
                  value: { $concat: ['$user.location.city', ', ', '$user.location.country'] },
                }),
              ],
            },
          },
        },
      ],
    }),
  ],
});
