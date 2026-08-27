import type { SchemaNode } from '@we/schema-shared';
import { field, formModal } from '@we/template-kit';

/**
 * NamePrompt — what to call somebody who arrived without a name.
 *
 * ## Why this exists
 *
 * WE collects a name exactly once, on the setup screen, and that screen is only reached when WE
 * creates the agent itself. An identity made anywhere else — the ADAM Launcher, Flux, a hosted node,
 * anything reached through ad4m-connect — already exists by the time WE boots, so `SessionStore`
 * goes straight from `login` to `ready` and nobody is ever asked. The result was a real population
 * of members whose posts, comments and call tiles carried no name at all.
 *
 * `getProfile` now reads the launcher's and Flux's formats, which recovers a name for anyone who set
 * one in the app they came from. This is for whoever is left: an agent that genuinely has no name
 * anywhere.
 *
 * ## Why it is chrome rather than part of a page
 *
 * The same reason as `ConsentPrompt`: the question does not arrive while the user is looking at any
 * particular thing. It becomes answerable the moment the own-profile fetch lands, which is a few
 * hundred milliseconds after the app appears, wherever the deep link happened to put them.
 *
 * ## Why it can be dismissed
 *
 * Nothing here is load-bearing — the app works perfectly well for somebody called `Anonymous`, and a
 * modal that cannot be dismissed is a wall in front of an app somebody has already signed in to.
 * `dismissNamePrompt` is session-scoped rather than persisted, so it asks again next launch and
 * stops for good once there is a name. See the store for why that asymmetry is the right one.
 *
 * The gate is `profileStore.needsName`, which is settled-state only — it stays false until the fetch
 * has answered, so this never flashes at somebody who does have a name.
 */
export const namePrompt: SchemaNode = formModal({
  open: { $store: 'profileStore.needsName' },
  // Dismissing is answering "not now", which is the only other answer there is. The backdrop, the
  // close button and Cancel all land here.
  close: { $action: 'profileStore.dismissNamePrompt' },
  title: 'What should we call you?',
  // One field. `md` would be a dialog four times the width of the thing it holds.
  size: 'sm',
  localState: { promptName: { type: 'string', initial: '' } },
  children: [
    {
      type: 'we-text',
      props: { color: 'text-muted' },
      children: [
        'Your account was set up outside WE, so we do not have a name for you yet. This is what other people will see on your posts and messages.',
      ],
    },
    field({ name: 'promptName', label: 'Name', placeholder: 'Name...' }),
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: ['You can change this any time from your profile.'],
    },
  ],
  // The precondition, not a validation rule: a name is whatever somebody says it is, so there is
  // nothing to judge locally beyond whether they typed anything at all.
  disabled: { $not: { $local: 'promptName' } },
  submitLabel: 'Save',
  cancelLabel: 'Not now',
  // Not `updateOwnProfile`: the store action dismisses before it publishes, so a failed write
  // cannot re-raise this modal on top of the toast explaining the failure.
  submit: { $action: 'profileStore.saveNameFromPrompt', args: [{ $local: 'promptName' }] },
  // No discard guard. One word is not worth a second dialog asking whether they meant to close the
  // first — and "Not now" is a legitimate answer here, not an accident to be caught.
});
