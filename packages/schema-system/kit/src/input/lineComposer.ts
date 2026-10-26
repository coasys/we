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
 * So the in-flight guard written once in `onSubmit` covers both, and a slow write cannot be sent
 * twice from either.
 *
 * The caller declares `sending` above this, since its handler raises and lowers it.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

export interface LineComposerOptions {
  /** What the empty box says. */
  placeholder: string;
  /** What the button says when hovered, and to a screen reader. */
  sendLabel: string;
  /** Sends one line — `event.text` and `event.marks`. Guard it on `local.sending`. */
  onSubmit: SchemaProp;
  /**
   * The name of a `function` local the caller declares, to receive a call that puts the caret in
   * the box: `{ $callLocal: '<name>' }` from anything on the page that invites somebody to write.
   */
  focusLocal?: string;
}

export function lineComposer(opts: LineComposerOptions): SchemaNode {
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
              disabled: { $: 'local.sending' },
              loading: { $: 'local.sending' },
              onClick: { $callLocal: 'sendLine' },
            },
            children: [{ type: 'we-icon', props: { name: 'paper-plane-tilt' } }],
          },
        ],
      },
    ],
  };
}
