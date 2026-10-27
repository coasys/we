import type { RouteSchema } from '@we/schema-shared';
import { profilePage } from '@we/template-kit';

import { viewBar } from './bar.ts';

/** The person on screen: the one the address names. */
const DID = 'routeStore.params.did';

/**
 * A member, as the view: their profile, the same page WE's own profile is (the kit's `profilePage`),
 * with their details in it. Yours is editable here as it is under the settings cog; anyone else's is
 * to read.
 *
 * Reached from People in the tree and on the People page.
 */
export const personRoute: RouteSchema = {
  path: '/person',
  type: 'Column',
  props: { width: '100%', height: '100%' },
  children: [
    {
      type: '$agent',
      props: { did: { $: DID }, as: 'person' },
      children: [
        viewBar([{ $: "person.name ? person.name : 'Member'" }], 'user'),
        {
          type: 'Column',
          props: { flex: '1', minHeight: '0', overflowY: 'auto' },
          children: [profilePage({ as: 'person', editable: 'person.did == me.did' })],
        },
      ],
    },
  ],
};
