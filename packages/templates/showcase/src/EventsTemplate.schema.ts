/**
 * Events with RSVPs — the template with the best coverage-per-line in the set, because almost
 * everything it needs was already built and undemonstrated.
 *
 * RSVP is `WeNode.participants`, which every node has had all along; the calendar is the `Calendar`
 * component; location is `LocationBlock`, the same one the globe module maps. This template added
 * nothing to the substrate at all — it is arrangement over parts that were sitting unused, which
 * makes it the clearest evidence that the vocabulary is ahead of what the templates ask of it.
 *
 * ## RSVP is add-only, and that is a correctness property
 *
 * `participants` is a bag of DIDs where **each agent writes only its own entry**. That is what keeps
 * it conflict-free without coordination: nothing here reads the roster and writes it back, so two
 * people RSVPing at once cannot drop each other. The transcribe module got this wrong once — it
 * appended every participant it could see, turning the set into a multiset that grew every session —
 * and the rule is written on `WeNode.participants` because of it.
 *
 * Un-RSVPing removes only your own entry, for the same reason.
 */
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { agentByline, collectionFeed, emptyState, peopleRow } from '@we/template-kit';

import { composerModal, KIND } from './shared.ts';

/** Am I on this roster? `$in` over the DID list — membership, not a scan. */
const isAttending = (as: string) => ({ $in: ['$me.did', `$${as}.participants`] });

const rsvpButton = (as: string): SchemaNode => ({
  type: '$if',
  props: {
    condition: isAttending(as),
    then: {
      type: 'we-button',
      props: {
        variant: 'secondary',
        size: 'sm',
        // Removes this agent's own entry and nothing else — see the note on add-only rosters.
        onClick: { $action: 'spaceStore.setAttending', args: [`$${as}.id`, false] },
      },
      children: [{ type: 'we-icon', props: { name: 'check' } }, 'Going'],
    },
    else: {
      type: 'we-button',
      props: {
        variant: 'primary',
        size: 'sm',
        onClick: { $action: 'spaceStore.setAttending', args: [`$${as}.id`, true] },
      },
      children: ['RSVP'],
    },
  },
});

const eventCard: SchemaNode = {
  type: 'Column',
  props: {
    width: '100%',
    gap: '300',
    p: '400',
    bg: 'surface-sunken',
    r: '400',
    border: '1px solid border',
  },
  children: [
    {
      type: 'Row',
      props: { ax: 'between', ay: 'start', width: '100%', gap: '400' },
      children: [
        {
          type: 'Column',
          props: { gap: '200', flex: '1', minWidth: '0' },
          children: [
            { type: 'we-text', props: { variant: 'heading-sm' }, children: ['$event.title'] },
            agentByline({ did: '$event.author', timestamp: '$event.createdAt', avatarSize: 'xs' }),
          ],
        },
        rsvpButton('event'),
      ],
    },
    {
      type: 'BlockRenderer',
      props: {
        editorState: '$event.editorState',
      },
    },
    {
      type: 'Row',
      props: { gap: '400', ay: 'center', width: '100%', minHeight: '32px' },
      children: [
        // The roster, drawn from `participants`. `minHeight` on the row because AvatarStack has no
        // height with no avatars, and profiles resolve after the record they belong to — without a
        // floor the row collapses and then shoves everything below it down a second time.
        peopleRow({ items: '$event.participants', dids: true, noun: 'going', max: 6 }),
      ],
    },
  ],
};

export const eventsTemplate: TemplateSchema = {
  meta: {
    name: 'Events',
    description: 'Events with RSVPs, built from participants, event blocks and the calendar.',
    icon: 'calendar',
    // Retro's warmer primary hue suits an invitation better than the neutral default.
    themeId: 'retro',
  },
  type: 'Column',
  props: { bg: 'page', width: '100%', minHeight: '100%', ax: 'center' },
  $localState: { composeOpen: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', p: '500', gap: '500' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center', width: '100%' },
          children: [
            { type: 'we-text', props: { variant: 'heading-lg' }, children: ['Events'] },
            {
              type: 'we-button',
              props: { variant: 'primary', size: 'sm', onClick: { $setLocal: 'composeOpen', value: true } },
              children: [{ type: 'we-icon', props: { name: 'plus' } }, 'New event'],
            },
          ],
        },

        composerModal({
          openLocal: 'composeOpen',
          title: 'New event',
          kind: KIND.event,
          saveLabel: 'Create',
        }),

        collectionFeed({
          kind: KIND.event,
          as: 'event',
          // Ascending: an events list is a schedule, and a schedule reads forwards. (Sorting by the
          // event's own start date rather than when it was posted wants an `EventBlock` child's
          // field, which is relation-property ordering — available, but it needs the block
          // hydrated, so it waits until the template has a reason to hydrate it.)
          order: 'asc',
          empty: emptyState({
            icon: 'calendar',
            label: 'events',
            message: 'Nothing planned yet. Create an event and people can RSVP.',
          }),
          children: [eventCard],
        }),
      ],
    },
  ],
};
