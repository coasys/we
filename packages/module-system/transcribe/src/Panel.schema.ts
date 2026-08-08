/**
 * The transcription panel — live feedback while transcribing, and nothing when not.
 *
 * Tied to `enabled` rather than to a separate open/closed flag, unlike the notes panel. Notes is a
 * place you go; this is a thing that is happening, and a panel that could be open while the module
 * was off would be an empty box that explains nothing. The transcript itself is not in here — it is
 * in the space, as blocks — so there is nothing to come back to this panel to read.
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
              { type: 'we-icon', props: { name: icon, color: 'neutral-400' } },
              { type: 'we-text', props: { variant: 'footnote', color: 'neutral-500' }, children: [text] },
            ],
          },
          ...(action ? [action] : []),
        ],
      },
    },
  };
}

export const panel: SchemaNode = {
  type: '$if',
  props: {
    condition: { $and: [{ $store: 'datasetStore.currentDataset' }, { $store: 'modules.transcribe.enabled' }] },
    then: {
      type: 'Column',
      props: {
        position: 'fixed',
        top: '0px',
        // Beside the module rail, not under it — the rail has to stay reachable while a panel is open.
        right: '48px',
        width: '320px',
        height: '100%',
        bg: 'neutral-0',
        borderLeft: '1px solid neutral-200',
        p: '400',
        gap: '400',
        zIndex: 'sticky',
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
              type: 'we-button',
              props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.transcribe.toggle' } },
              children: [{ type: 'we-icon', props: { name: 'x' } }],
            },
          ],
        },

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
                { type: 'we-text', props: { variant: 'footnote', color: 'neutral-500' }, children: ['Starting…'] },
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
            type: 'we-button',
            props: {
              size: 'sm',
              variant: 'secondary',
              // The point of naming the reason is that it can be acted on, so the panel goes there
              // rather than describing where to look.
              onClick: { $action: 'shellStore.openShellView', args: ['settings', '/ai'] },
            },
            children: ['Open AI settings'],
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

        // ── What has been heard ──────────────────────────────────────────────
        {
          type: '$if',
          props: {
            condition: { $store: 'modules.transcribe.pending' },
            then: {
              type: 'Column',
              props: { bg: 'primary-50', r: '300', p: '300', gap: '200' },
              children: [
                {
                  type: 'Row',
                  props: { ax: 'between', ay: 'center' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'neutral-500', uppercase: true },
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
                      props: { bg: 'neutral-50', r: '300', p: '300' },
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
