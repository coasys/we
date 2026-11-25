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
   * the caller's `onSubmit` reads as `{ $: 'local.attachments' }`. The composer empties the list when
   * the send *resolves* — not when it starts, so a send that fails leaves the files to try again —
   * and only if that send is the latest and the list is still the one it took, so files picked while
   * a slow send ran stay, and an earlier send that resolves late does not empty a later one's.
   * That is carried by an `onSuccess` the composer adds to every `$invoke` in `onSubmit` (through
   * `$if` branches too), so `onSubmit` must be made of `$invoke`s whose action returns a promise.
   * A file over {@link ATTACH_MAX_BYTES} is refused with a line saying so.
   */
  attach?: { label: string };
}

/** The most one attached file may hold: the send reads it whole into memory and encodes it. */
export const ATTACH_MAX_BYTES = 25 * 1024 * 1024;
const ATTACH_MAX_LABEL = `${ATTACH_MAX_BYTES / (1024 * 1024)} MB`;

/** The attach control's drop zone, stripped to the button it holds: no frame, no padding, no minimum height. */
const ATTACH_STYLES = { border: 'none', padding: '0', minHeight: '0', width: 'fit-content' };

/** The paperclip beside the send button; the files it takes are the `attachments` local. */
function attachControl(label: string): SchemaNode {
  return {
    type: 'we-file-upload',
    props: {
      label,
      multiple: true,
      hideList: true,
      maxSize: ATTACH_MAX_BYTES,
      styles: ATTACH_STYLES,
      files: { $: 'local.attachments' },
      // The uploader says `change` before `reject` for one pick, so the note it leaves is this pick's.
      onChange: [
        { $setLocal: 'attachNote', value: '' },
        { $setLocal: 'attachments', value: { $: 'event.detail' } },
      ],
      onReject: {
        $setLocal: 'attachNote',
        value: { $: `"Files over ${ATTACH_MAX_LABEL} can't be attached: " + event.detail.names` },
      },
    },
    children: [
      {
        type: 'we-tooltip',
        props: { content: label },
        children: [
          {
            type: 'we-button',
            props: { label, square: true, variant: 'ghost' },
            children: [{ type: 'we-icon', props: { name: 'paperclip' } }],
          },
        ],
      },
    ],
  };
}

/** The files chosen, one chip each with its own remove — drawn only when there are some. */
const attachmentChips: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'count(local.attachments) > 0' },
    then: {
      type: 'Row',
      props: { gap: '100', ay: 'center', wrap: true },
      children: [
        {
          type: '$each',
          props: { items: { $: 'local.attachments' }, as: 'file' },
          children: [
            {
              type: 'Row',
              props: { gap: '100', ay: 'center', px: '200', r: '400', bg: 'surface-sunken' },
              children: [
                { type: 'we-text', props: { variant: 'footnote', truncate: true }, children: [{ $: 'file.name' }] },
                {
                  type: 'we-button',
                  props: {
                    size: 'xs',
                    variant: 'ghost',
                    label: 'Remove file',
                    onClick: {
                      $setLocal: 'attachments',
                      value: { $: 'local.attachments.filter(f, f != file)' },
                    },
                  },
                  children: [{ type: 'we-icon', props: { name: 'x' } }],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

const attachNote: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'local.attachNote' },
    then: {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-muted' },
      children: [{ $: 'local.attachNote' }],
    },
  },
};

export function lineComposer(opts: LineComposerOptions): SchemaNode {
  const row = lineRow(opts);
  if (!opts.attach) return row;
  return {
    type: 'Column',
    props: { gap: '100', width: '100%' },
    $localState: {
      attachments: { type: 'array', initial: [] },
      // The list as the latest send took it, and that send's event — what a send that resolves checks
      // against: only the latest send may empty the list, and only while it is still the list it took.
      sentAttachments: { type: 'array', initial: [] },
      lastSend: { type: 'object', initial: null },
      // Why a file was left out, until the list changes again.
      attachNote: { type: 'string', initial: '' },
    },
    children: [attachmentChips, attachNote, row],
  };
}

/**
 * `onSubmit` with the list emptied once the send has resolved, if it is still the list that was sent.
 * Only an `$invoke` settles, so the `onSuccess` goes on each one, down through `$if` branches.
 */
function emptiedWhenSent(token: SchemaProp): SchemaProp {
  if (Array.isArray(token)) return token.map(emptiedWhenSent);
  if (!token || typeof token !== 'object') return token;
  const node = token;
  if (typeof node.$invoke === 'string') {
    return { ...node, onSuccess: [...((node.onSuccess as unknown[]) ?? []), EMPTY_IF_UNCHANGED] };
  }
  const branch = node.$if as Record<string, SchemaProp> | undefined;
  if (branch) {
    return {
      ...node,
      $if: {
        ...branch,
        ...(branch.then !== undefined && { then: emptiedWhenSent(branch.then) }),
        ...(branch.else !== undefined && { else: emptiedWhenSent(branch.else) }),
      },
    };
  }
  return token;
}

const EMPTY_IF_UNCHANGED = {
  $if: {
    condition: { $: 'event == local.lastSend && local.attachments == local.sentAttachments' },
    then: { $setLocal: 'attachments', value: [] },
  },
};

function lineRow(rawOpts: LineComposerOptions): SchemaNode {
  const opts = rawOpts.attach
    ? {
        ...rawOpts,
        onSubmit: [
          { $setLocal: 'sentAttachments', value: { $: 'local.attachments' } },
          { $setLocal: 'lastSend', value: { $: 'event' } },
          emptiedWhenSent(rawOpts.onSubmit),
        ].flat(),
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
      ...(opts.attach ? [attachControl(opts.attach.label)] : []),
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
