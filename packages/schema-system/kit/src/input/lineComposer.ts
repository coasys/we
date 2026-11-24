/**
 * A one-line message box: the block composer in its compact mode, framed as a field, with a send
 * button beside it — what the transcript, the Feed and a channel's chat write through.
 *
 * ## The field is the composer's
 *
 * In `compact` mode the composer draws a field of its own — the fill, edge, radius and control height
 * of the text area it replaced — so this only places it and the button side by side, aligned at the
 * bottom so the button stays with the last line as the box grows.
 *
 * ## One send, two ways in
 *
 * Enter and the button run the same handler: the button calls the composer's own `submit`, handed
 * out through `onReady`, which sends through `onSubmit` exactly as Enter does and empties the line.
 * So whatever `onSubmit` does covers both.
 *
 * A caller whose write is slow and shown only once done can guard against a second send: declare a
 * `sending` local its handler raises and lowers, skip `onSubmit` while it is up, and pass
 * `sending: { $: 'local.sending' }` so the button disables and spins too. A caller that draws the
 * message at once has nothing in flight to wait for, and passes none.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

export interface LineComposerOptions {
  /** What the empty box says. */
  placeholder: string;
  /** What the button says when hovered, and to a screen reader. */
  sendLabel: string;
  /** Sends one line — `event.text` and `event.marks`. */
  onSubmit: SchemaProp;
  /**
   * An expression for "a send is in flight". When given, the send button is disabled and shows a
   * spinner while it holds; the caller guards `onSubmit` on the same expression.
   */
  sending?: SchemaProp;
  /**
   * The name of a `function` local the caller declares, to receive a call that puts the caret in
   * the box: `{ $callLocal: '<name>' }` from anything on the page that invites somebody to write.
   */
  focusLocal?: string;
  /**
   * Offer to attach files. The files chosen are the `attachments` local — a list of browser `File`s
   * the caller's `onSubmit` reads as `{ $: 'local.attachments' }` — and the composer empties it
   * after the submit, as it empties the line.
   */
  attach?: { label: string };
}

/** What the attach control looks like: a quiet line under the box, not a drop zone. */
const ATTACH_STYLES = {
  border: 'none',
  padding: '0',
  minHeight: '0',
  alignItems: 'flex-start',
  gap: '100',
  width: 'fit-content',
};

export function lineComposer(opts: LineComposerOptions): SchemaNode {
  const row = lineRow(opts);
  if (!opts.attach) return row;
  return {
    type: 'Column',
    props: { gap: '100', width: '100%' },
    $localState: { attachments: { type: 'array', initial: [] } },
    children: [
      row,
      {
        type: 'we-file-upload',
        props: {
          multiple: true,
          styles: ATTACH_STYLES,
          files: { $: 'local.attachments' },
          onChange: { $setLocal: 'attachments', value: { $: 'event.detail' } },
        },
        children: [
          {
            type: 'Row',
            props: { gap: '100', ay: 'center' },
            children: [
              { type: 'we-icon', props: { name: 'paperclip' } },
              { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [opts.attach.label] },
            ],
          },
        ],
      },
    ],
  };
}

function lineRow(rawOpts: LineComposerOptions): SchemaNode {
  const opts = rawOpts.attach
    ? {
        ...rawOpts,
        onSubmit: [rawOpts.onSubmit, { $setLocal: 'attachments', value: [] }].flat(),
      }
    : rawOpts;
  return {
    type: 'Row',
    props: { gap: '200', ay: 'end', width: '100%' },
    // The composer's own send, once it is ready: what the button presses.
    $localState: { sendLine: { type: 'function', initial: null } },
    children: [
      {
        type: 'Column',
        // Takes the row's spare width: the composer sizes itself to its container.
        props: { flex: '1', minWidth: '0' },
        children: [
          {
            type: 'BlockComposer',
            props: {
              compact: true,
              autoFocus: false,
              handles: false,
              placeholder: opts.placeholder,
              onReady: opts.focusLocal
                ? [
                    { $setLocal: 'sendLine', value: { $: 'event.submit' } },
                    { $setLocal: opts.focusLocal, value: { $: 'event.focus' } },
                  ]
                : { $setLocal: 'sendLine', value: { $: 'event.submit' } },
              onSubmit: opts.onSubmit,
            },
          },
        ],
      },
      {
        type: 'we-tooltip',
        props: { content: opts.sendLabel },
        children: [
          {
            type: 'we-button',
            props: {
              label: opts.sendLabel,
              square: true,
              variant: 'soft',
              ...(opts.sending === undefined ? {} : { disabled: opts.sending, loading: opts.sending }),
              onClick: { $callLocal: 'sendLine' },
            },
            children: [{ type: 'we-icon', props: { name: 'paper-plane-tilt' } }],
          },
        ],
      },
    ],
  };
}
