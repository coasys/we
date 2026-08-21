import type { SchemaNode } from '@we/schema-shared';
import { gatePrompt } from '@we/template-kit';

// The join prompt body differs depending on whether this is the WE global discovery space
// or just a regular shared space the user hasn't joined yet.
const isGlobalSpace = { $eq: [{ $store: 'routeStore.segments.1' }, { $store: 'datasetStore.globalSpaceId' }] };

// Whether the join running right now is this route's. The store holds the id rather than a flag,
// so this is also what stops a join started elsewhere from spinning the button here.
const joiningThisSpace = { $eq: [{ $store: 'spaceStore.joiningSpace' }, { $store: 'routeStore.segments.1' }] };

/**
 * The join control, and the two things a join needs to be able to say.
 *
 * Joining a shared space is not a quick call. The backend has to fetch the space and install its
 * sync language before the thing exists anywhere, which on a first join runs past the transport's
 * own patience — so the button holds its loading state for as long as the *store* is still working,
 * not for as long as one network call lasts, and says so once that stops looking instant. A failure
 * is stated in place: this is a dead end, and a toast someone can miss would leave them looking at
 * a button that had quietly gone back to resting, having apparently done nothing at all.
 *
 * `joining` used to be `$localState` on the button. It could not be anything better while the store
 * swallowed the failure and resolved, which made every outcome look identical from out here.
 */
function joinControls(label: string): SchemaNode[] {
  return [
    {
      type: 'we-button',
      props: {
        text: label,
        variant: 'primary',
        loading: joiningThisSpace,
        disabled: joiningThisSpace,
        onClick: { $action: 'spaceStore.joinSpace', args: [{ $store: 'routeStore.segments.1' }] },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $and: [joiningThisSpace, { $store: 'spaceStore.joinSlow' }] },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'textFaint', textAlign: 'center', maxWidth: '400px' },
          children: ['Still joining. A first join has to fetch and install the space, which can take a minute.'],
        },
      },
    },
    {
      type: '$if',
      props: {
        // The failure has to be *this* space's, not merely the most recent one anywhere.
        condition: { $eq: [{ $store: 'spaceStore.joinError.spaceId' }, { $store: 'routeStore.segments.1' }] },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'dangerText', textAlign: 'center', maxWidth: '400px' },
          children: [{ $store: 'spaceStore.joinError.message' }],
        },
      },
    },
  ];
}

const globalSpaceJoinPrompt: SchemaNode = gatePrompt({
  icon: 'globe-hemisphere-west',
  iconGradient: 'primary',
  title: 'Join the global discovery space',
  body: "This is the WE network's global discovery space — find communities and people from across the network. Join to explore spaces on the globe and connect with others.",
  children: joinControls('Join'),
});

const regularSpaceJoinPrompt: SchemaNode = gatePrompt({
  icon: 'lock',
  iconGradient: 'primary',
  title: 'Join this Space',
  body: "You haven't joined this space yet. Click below to connect and start collaborating.",
  children: joinControls('Join Space'),
});

/*
  A dead end rather than an invitation, and it says so before it is read: a flat warning icon
  instead of the gradient the join prompts carry. Nothing the reader does here changes it — the
  seed file is not theirs to edit from inside the app.
*/
const notConfiguredPrompt: SchemaNode = gatePrompt({
  icon: 'warning',
  title: 'Global space not configured',
  body: 'No global space URL has been set in we-seed.json. Add a globalSpaceUrl to enable joining.',
});

// Shown when the user has not yet joined the space.
// Renders a join prompt, or a config warning if no global space URL is set.
export const spaceGate: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'datasetStore.globalSpaceConfigured' },
    then: {
      type: '$if',
      props: {
        condition: isGlobalSpace,
        then: globalSpaceJoinPrompt,
        else: regularSpaceJoinPrompt,
      },
    },
    else: notConfiguredPrompt,
  },
};
