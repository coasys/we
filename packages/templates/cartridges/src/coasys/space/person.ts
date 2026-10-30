import type { RouteSchema } from '@we/schema-shared';
import { profilePage } from '@we/template-kit';

import { viewBar } from './bar.ts';
import { groupPath } from './paths.ts';

/** The person on screen: the one the address names. */
const DID = 'routeStore.params.did';

/**
 * A member, as the view: their profile, the same page WE's own profile is (the kit's `profilePage`),
 * with their details in it, to read. Changing your own is the agent's to do, which a space template
 * may not reach, so on yours the bar offers the profile page under the settings cog instead.
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
        viewBar(
          [
            { label: 'People', onClick: { $invoke: 'routeStore.navigate', args: [{ $: groupPath('people') }] } },
            { label: { $: "person.name ? person.name : 'Member'" } },
          ],
          'user',
          [
            {
              type: '$if',
              props: {
                condition: { $: 'person.did == me.did' },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'soft',
                    onClick: { $invoke: 'shellStore.openShellView', args: ['profile'] },
                  },
                  children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }, 'Edit profile'],
                },
              },
            },
          ],
        ),
        {
          type: 'Column',
          props: { flex: '1', minHeight: '0', overflowY: 'auto' },
          children: [profilePage({ as: 'person', editable: false })],
        },
      ],
    },
  ],
};
