import type { SchemaNode } from '@we/schema-shared';
import { formModal } from '@we/template-kit';

const close = { $action: 'shellStore.setJoinSpaceOpen', args: [false] };

/**
 * Somewhere to put an address somebody sent you.
 *
 * ## Why this exists at all
 *
 * On the web a share link *is* the invitation: it is a URL, the browser opens it, and the space
 * gate takes over. Nothing about that generalises. A desktop build has no address bar, and the
 * electron app registers no protocol handler — no `setAsDefaultProtocolClient`, no `open-url` — so
 * a link cannot reach it under any circumstances. Joining a space there meant knowing to look in
 * Settings → Spaces & data, which is not somewhere anybody looks when a colleague has just pasted
 * an address into a chat.
 *
 * Deep links would close the first half of that and are separate work. They would not close the
 * second: an address that arrives by a route the OS cannot follow — a chat message, a QR code, a
 * whiteboard, somebody reading it out — still needs a box to go in.
 *
 * ## Why a dialog rather than a field in the rail
 *
 * The obvious cheap version is an input that unfolds under the sidebar's `+`, and it does not work.
 * `railShell` collapses on pointer-out, and everything inside it is gated on `expanded` — so the
 * field would be torn down the moment somebody moved the mouse away to fetch what they were
 * pasting, which is the single most likely thing for them to do. The rail is also 240px at its
 * widest, against an address that is routinely longer than that.
 *
 * A dialog also has room for the part the settings field never had: a first join fetches and
 * installs the whole neighbourhood before it exists locally, which routinely takes a minute. See
 * `joinSlow`.
 *
 * ## One dialog, two doors
 *
 * Chrome rather than part of either surface that opens it — the sidebar's spaces group and the
 * settings page — for the reason `createSpaceModal` is: two page-scoped copies could disagree about
 * whether the one dialog was open, and a page-scoped flag can only be set from inside its page.
 */
const joinSpaceModal: SchemaNode = formModal({
  open: { $: 'shellStore.joinSpaceOpen' },
  close,
  title: 'Join a space',
  size: 'sm',
  localState: { link: { type: 'string', initial: '' } },
  /*
    No discard guard. The convention's own rule is that a guard covering one short field costs more
    attention than the field is worth — and what is in here was pasted from somewhere else, so it is
    still wherever it came from.
  */
  children: [
    {
      type: 'we-form-field',
      props: {
        label: 'Space address',
        /*
          Every form the link might have arrived in, said plainly, because `joinSpace` accepts all
          three — a full share URL, a `neighbourhood://` URI, or the bare CID out of either. Somebody
          who has been sent one of them should not have to work out whether it is the right kind.
        */
        description: 'A share link, a neighbourhood:// address, or the id from either.',
      },
      children: [
        {
          type: 'we-input',
          props: {
            width: '100%',
            value: { $: 'local.link' },
            placeholder: 'neighbourhood://…',
            // Nothing else in this dialog to reach, and it opens because somebody is holding an
            // address they want to paste.
            autofocus: true,
            disabled: { $: 'spaceStore.joiningSpace' },
            onInput: { $setLocal: 'link', value: { $: 'event.detail' } },
          },
        },
      ],
    },
    /*
      That a slow join is still working, rather than stuck.

      Joining a shared space fetches and installs the neighbourhood before it exists anywhere
      locally, so a first join routinely takes about a minute — and a dialog spinning in silence for
      that long reads as a hang, which is when people press the button again. `joinSlow` is the
      store's own answer to how long is long enough to mention it.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'spaceStore.joinSlow' },
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-spinner', props: { size: 'xs', color: 'text-faint' } },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: ['Fetching the space. A first join can take a minute.'],
            },
          ],
        },
      },
    },
    /*
      And why it did not work, when it did not.

      From the store rather than a local, because the failure happens inside `joinSpace` and a schema
      has no way to catch it — `onError` fires, but the message it carries is the rejection, where
      `joinError` is the one the store has already made fit to read. Matched on nothing: this dialog
      only ever asks about the address in it, so the last failure is about this one.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'spaceStore.joinError' },
        then: {
          type: 'we-alert',
          props: { variant: 'danger', appearance: 'soft' },
          children: [{ $: 'spaceStore.joinError.message' }],
        },
      },
    },
  ],
  // Whether an address resolves is only knowable by trying it, so the button asks rather than
  // predicts — the same reasoning the settings field carried. In flight, `formModal` disables it.
  disabled: { $: '!local.link' },
  busy: { $: 'spaceStore.joiningSpace' },
  submitLabel: 'Join',
  /*
    `joinSpace` navigates to the space on success, so there is nothing to do after it but get out of
    the way — which `formModal` adds for us, so no `onSuccess` here. It rejects when the join
    genuinely could not be completed (a timeout the backend goes on to finish is waited out rather
    than reported), so the dialog stays open holding the address when it fails, with `joinError`
    above saying why.
  */
  submit: {
    $action: 'spaceStore.joinSpace',
    args: [{ $: 'local.link' }],
  },
});

/**
 * The dialog, gated on the shell flag — registered as chrome so it exists once, wherever it is
 * opened from. See `shellStore.joinSpaceOpen`.
 */
export const joinSpaceModalMount: SchemaNode = joinSpaceModal;
