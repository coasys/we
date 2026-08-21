/**
 * The transcription panel — live feedback while transcribing, and nothing when not.
 *
 * Keyed on `open`, not on whether we are recording. Those were one flag to begin with, which meant
 * the transcript disappeared the instant you stopped recording — exactly when you want to read it —
 * and left no way to check what had been captured without starting again.
 *
 * So: the call bar's button records, this panel shows, and either can be true without the other.
 * Recording does open the panel once, because starting something invisible and saying nothing about
 * it is how a feature comes to look broken.
 *
 * In its own `.schema.ts` file so `pnpm --filter @we/schema-shared validate` checks it. The validator
 * walks files by that name, and module fragments declared inline in an `index.ts` were invisible to
 * it — which is how a module could ship a typo'd prop that only appears as a component silently not
 * rendering. The other three modules still declare their fragments inline; this is the shape they
 * should move to.
 */
import { type SchemaNode } from '@we/schema-shared';

/**
 * A message shown for exactly one status.
 *
 * Every reason this module can produce nothing gets its own line, because from the user's side they
 * are indistinguishable — an empty panel means "nobody is speaking", "no model is installed" and
 * "this backend cannot transcribe" equally well, and only one of those is worth acting on.
 */
function note(status: string, icon: string, text: string, action?: SchemaNode): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $eq: [{ $store: 'modules.transcribe.status' }, status] },
      then: {
        type: 'Column',
        props: { gap: '200', ay: 'start' },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'start' },
            children: [
              { type: 'we-icon', props: { name: icon, color: 'textFaint' } },
              { type: 'we-text', props: { variant: 'footnote', color: 'textMuted' }, children: [text] },
            ],
          },
          ...(action ? [action] : []),
        ],
      },
    },
  };
}

/**
 * The microphone level, with the line speech has to cross drawn on it.
 *
 * The threshold marker is the point. A bare level bar answers "is audio arriving", which was never
 * really in doubt; what a user actually needs when nothing is being transcribed is "am I loud
 * enough", and that is only answerable against the number the VAD compares to. Both come from the
 * same measurement in the worklet, so the bar and the decision cannot disagree.
 *
 * Both widths arrive from the store as CSS percentages — the scale factor is a property of how loud
 * speech is, and belongs next to the numbers rather than in a template.
 */
const meter: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.transcribe.enabled' },
    then: {
      type: 'Column',
      props: { gap: '150' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'textMuted' },
              children: ['Microphone'],
            },
            {
              // Says which side of the threshold we are on, for anyone who cannot read the bar.
              type: 'we-text',
              props: {
                variant: 'footnote',
                color: {
                  $if: {
                    condition: { $store: 'modules.transcribe.speaking' },
                    then: 'successText',
                    else: 'textFaint',
                  },
                },
              },
              children: [
                {
                  $if: {
                    condition: { $store: 'modules.transcribe.speaking' },
                    then: 'hearing you',
                    else: 'quiet',
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'Row',
          props: {
            position: 'relative',
            height: '8px',
            width: '100%',
            bg: 'surfaceSunken',
            r: 'pill',
            overflow: 'hidden',
          },
          children: [
            {
              type: 'Row',
              props: {
                height: '100%',
                r: 'pill',
                bg: {
                  $if: {
                    condition: { $store: 'modules.transcribe.speaking' },
                    then: 'success-500',
                    else: 'surfaceActive',
                  },
                },
                // `styles` rather than `width`, because the value is computed per frame and a DS prop
                // takes a token. This is the escape hatch working as intended.
                styles: {
                  width: { $store: 'modules.transcribe.levelPercent' },
                  transition: 'width 80ms linear',
                  'max-width': '100%',
                },
              },
            },
            {
              // The onset threshold, read from the store so it cannot drift from the VAD's own value.
              type: 'Row',
              props: {
                position: 'absolute',
                top: '0px',
                height: '100%',
                width: '2px',
                bg: 'borderStrong',
                styles: { left: { $store: 'modules.transcribe.thresholdPercent' } },
              },
            },
          ],
        },
      ],
    },
  },
};

/**
 * Suggestions the backend staged instead of writing, and the two buttons that resolve them.
 *
 * Only appears when there are any, which is *not* the common case: a value is staged only where a
 * human already owns one, so a first pass over a fresh transcript stages nothing and this stays
 * invisible. That is the right default — a permanently empty "0 pending" box teaches people to stop
 * looking at the place their attention is eventually needed.
 *
 * Accept and reject rather than an edit affordance. Editing a suggestion is authoring, and it
 * belongs to whatever normally edits that record; the decision this list exists for is only whether
 * the model's version survives contact with the person who owns the value.
 */
const proposals: SchemaNode = {
  type: '$if',
  props: {
    condition: { $count: { items: { $store: 'modules.transcribe.proposals' } } },
    then: {
      type: 'Column',
      props: { gap: '200' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'textMuted', uppercase: true },
          children: ['Awaiting your call'],
        },
        {
          type: '$each',
          props: { items: { $store: 'modules.transcribe.proposals' }, as: 'proposal' },
          children: [
            {
              type: 'Column',
              props: { bg: 'warningSurface', r: '300', p: '300', gap: '200' },
              children: [
                { type: 'we-text', props: { variant: 'footnote' }, children: ['$proposal.summary'] },
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center' },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        size: 'xs',
                        variant: 'secondary',
                        onClick: { $action: 'modules.transcribe.acceptProposal', args: ['$proposal.id'] },
                      },
                      children: ['Keep'],
                    },
                    {
                      type: 'we-button',
                      props: {
                        size: 'xs',
                        variant: 'ghost',
                        onClick: { $action: 'modules.transcribe.rejectProposal', args: ['$proposal.id'] },
                      },
                      children: ['Discard'],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

/**
 * Turning what was heard into tasks and events.
 *
 * Sits below the transcript rather than in the header, because it is a thing you do *to* what is
 * there — and it should not be reachable before there is anything to do it to. The whole block is
 * absent on a node that cannot interpret: unlike a missing transcription model, there is nothing a
 * user can install to fix it from here, so a disabled button explaining itself would be furniture.
 *
 * One press, one pass, and a count afterwards. An LLM call takes seconds, and the gap between press
 * and result is exactly where a feature stops looking like it is working — so `running` says so, and
 * `done` keeps its number until the next press rather than reverting to a blank button.
 */
const extract: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.transcribe.extractable' },
    then: {
      type: 'Column',
      props: { gap: '200', bg: 'surfaceSunken', r: '300', p: '300' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center', gap: '300' },
          children: [
            {
              type: 'Column',
              props: { gap: '050' },
              children: [
                { type: 'we-text', props: { variant: 'footnote', fontWeight: '600' }, children: ['Extract'] },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'textMuted' },
                  children: ['Find the tasks and events in what was said.'],
                },
              ],
            },
            {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: 'secondary',
                // Disabled rather than hidden once the panel is showing the section: the reason is
                // "nothing has been said yet", which resolves on its own and is worth waiting for.
                disabled: {
                  $or: [
                    { $not: { $store: 'modules.transcribe.canExtract' } },
                    { $eq: [{ $store: 'modules.transcribe.extractStatus' }, 'running'] },
                  ],
                },
                onClick: { $action: 'modules.transcribe.extract' },
              },
              children: [
                {
                  $if: {
                    condition: { $eq: [{ $store: 'modules.transcribe.extractStatus' }, 'running'] },
                    then: 'Reading…',
                    else: 'Extract',
                  },
                },
              ],
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'modules.transcribe.extractStatus' }, 'running'] },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-spinner', props: { size: 'sm' } },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'textMuted' },
                  children: ['Reading the transcript…'],
                },
              ],
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'modules.transcribe.extractStatus' }, 'done'] },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'check', color: 'successText' } },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'textMuted' },
                  children: [
                    // Zero is a real and common answer — a conversation with no commitments in it —
                    // and saying so is the difference between "it worked, there was nothing" and
                    // "it silently failed".
                    {
                      $if: {
                        condition: { $store: 'modules.transcribe.extractCount' },
                        then: { $store: 'modules.transcribe.extractCount' },
                        else: 'No',
                      },
                    },
                    ' records written. Open the graph to see them.',
                  ],
                },
              ],
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'modules.transcribe.extractStatus' }, 'error'] },
            then: {
              type: 'we-alert',
              props: { variant: 'warning' },
              children: [{ $store: 'modules.transcribe.extractError' }],
            },
          },
        },
        proposals,
      ],
    },
  },
};

export const panel: SchemaNode = {
  type: '$if',
  props: {
    condition: { $and: [{ $store: 'datasetStore.currentDataset' }, { $store: 'modules.transcribe.open' }] },
    then: {
      type: 'Column',
      props: {
        /**
         * Fills the box the host gave it. It used to position itself — `fixed`, `right: 48px`, a
         * hardcoded copy of the module rail's width — which meant it overlaid the space rather than
         * making room in it, sat on top of the editor's controls, and stayed put when a docked call
         * panel took the edge out from under it. All three are the host's job; see `docks` below.
         */
        width: '100%',
        height: '100%',
        p: '400',
        gap: '400',
        overflow: 'hidden',
      },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Transcript'] },
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'modules.transcribe.listening' },
                    then: { type: 'we-badge', props: { variant: 'danger', size: 'xs' }, children: ['REC'] },
                  },
                },
              ],
            },
            {
              type: 'Row',
              props: { gap: '100', ay: 'center' },
              children: [
                {
                  // The panel's own record control. The call bar is the natural place for it during a
                  // call, but the panel has to be self-sufficient: it opens outside a call too, and a
                  // template may place neither the bar nor the rail.
                  type: 'we-button',
                  props: {
                    variant: {
                      $if: { condition: { $store: 'modules.transcribe.enabled' }, then: 'secondary', else: 'ghost' },
                    },
                    size: 'sm',
                    disabled: {
                      $and: [
                        { $not: { $store: 'modules.transcribe.enabled' } },
                        { $not: { $store: 'modules.transcribe.available' } },
                      ],
                    },
                    onClick: { $action: 'modules.transcribe.toggle' },
                    title: {
                      $if: {
                        condition: { $store: 'modules.transcribe.enabled' },
                        then: 'Stop transcribing',
                        else: 'Start transcribing',
                      },
                    },
                  },
                  children: [
                    {
                      type: 'we-icon',
                      props: {
                        name: 'record',
                        weight: {
                          $if: { condition: { $store: 'modules.transcribe.listening' }, then: 'fill', else: 'regular' },
                        },
                        color: {
                          $if: { condition: { $store: 'modules.transcribe.listening' }, then: 'dangerText', else: '' },
                        },
                      },
                    },
                  ],
                },
                {
                  type: 'we-button',
                  props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.transcribe.closePanel' } },
                  children: [{ type: 'we-icon', props: { name: 'x' } }],
                },
              ],
            },
          ],
        },

        // ── Is it hearing me? ────────────────────────────────────────────────
        meter,

        // ── Why nothing is happening, when nothing is ────────────────────────
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'modules.transcribe.status' }, 'starting'] },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-spinner', props: { size: 'sm' } },
                { type: 'we-text', props: { variant: 'footnote', color: 'textMuted' }, children: ['Starting…'] },
              ],
            },
          },
        },
        {
          // The panel opened, nothing recorded yet, nothing wrong. Without this the box is empty and
          // reads as broken rather than as waiting.
          type: '$if',
          props: {
            condition: {
              $and: [
                { $not: { $store: 'modules.transcribe.enabled' } },
                { $not: { $count: { items: { $store: 'modules.transcribe.recent' } } } },
              ],
            },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'textMuted', italic: true },
              children: [
                {
                  $if: {
                    condition: { $store: 'modules.transcribe.available' },
                    then: 'Press record to transcribe what is said into text blocks in this space.',
                    else: 'Join a call and press record to transcribe what is said.',
                  },
                },
              ],
            },
          },
        },
        note('no-audio', 'microphone-slash', 'Nothing to listen to. Start or join a call and this will follow it.'),
        note('no-backend', 'plugs', 'This backend cannot transcribe — no speech-to-text is reachable from here.'),
        note(
          'no-model',
          'warning',
          'No transcription model is installed. Add one and transcription will start on its own.',
          {
            // Offered only where the section exists. AI administration is node-scoped, so a guest on
            // somebody else's executor — which includes every web session against a remote host —
            // has no AI settings to open, and a button that opens Settings to nothing is worse than
            // no button. The `else` says who can fix it instead.
            type: '$if',
            props: {
              condition: { $store: 'runtimeStore.canManageAi' },
              then: {
                type: 'we-button',
                props: {
                  size: 'sm',
                  variant: 'secondary',
                  // The point of naming the reason is that it can be acted on, so the panel goes
                  // there rather than describing where to look.
                  onClick: { $action: 'shellStore.openShellView', args: ['settings', '/ai'] },
                },
                children: ['Open AI settings'],
              },
              else: {
                type: 'we-text',
                props: { variant: 'footnote', color: 'textFaint' },
                children: ['Models are configured on the node this app is connected to.'],
              },
            },
          },
        ),
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'modules.transcribe.status' }, 'error'] },
            then: {
              type: 'we-alert',
              props: { variant: 'warning' },
              children: [{ $store: 'modules.transcribe.error' }],
            },
          },
        },

        // ── Turning it into records ──────────────────────────────────────────
        extract,

        // ── What has been heard ──────────────────────────────────────────────
        {
          type: '$if',
          props: {
            condition: { $store: 'modules.transcribe.pending' },
            then: {
              type: 'Column',
              props: { bg: 'accentMuted', r: '300', p: '300', gap: '200' },
              children: [
                {
                  type: 'Row',
                  props: { ax: 'between', ay: 'center' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'textMuted', uppercase: true },
                      children: ['Not saved yet'],
                    },
                    {
                      type: 'we-button',
                      props: { variant: 'ghost', size: 'xs', onClick: { $action: 'modules.transcribe.flushNow' } },
                      children: ['Save now'],
                    },
                  ],
                },
                { type: 'we-text', children: [{ $store: 'modules.transcribe.pending' }] },
              ],
            },
          },
        },
        {
          type: 'we-scroll-area',
          children: [
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                {
                  // Session-local, not a `$query` — these are the blocks *this* run wrote, shown as
                  // confirmation that speech is reaching the space. Querying every transcript block
                  // would be a different feature (reading the record) in a panel meant for watching
                  // it being made.
                  type: '$each',
                  props: { items: { $store: 'modules.transcribe.recent' }, as: 'line' },
                  children: [
                    {
                      type: 'Column',
                      props: { bg: 'surfaceSunken', r: '300', p: '300' },
                      children: [{ type: 'we-text', children: ['$line'] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};
