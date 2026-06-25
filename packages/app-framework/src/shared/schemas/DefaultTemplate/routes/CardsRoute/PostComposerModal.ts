import type { SchemaNode, SchemaProp } from '@we/schema-shared';

export interface PostComposerModalOptions {
  /** Modal heading, e.g. "Create Post" / "Edit Post" */
  title: string;
  /** $localState key (in an ancestor scope) controlling this modal's visibility */
  openLocal: string;
  /** Existing content to prefill the composer with (e.g. '$post.editorState'). Omit for a blank post. */
  editorState?: SchemaProp;
  /** Save action and its leading args — the composer's serialized JSON is appended as the final arg */
  saveAction: { $action: string; args: SchemaProp[] };
  /** Label for the primary button, e.g. "Post" / "Save" */
  saveLabel: string;
}

/** Shared "compose a post" modal — used for both creating and editing posts. */
export function postComposerModal(opts: PostComposerModalOptions): SchemaNode {
  return {
    type: 'we-modal',
    props: {
      close: { $setLocal: opts.openLocal, value: false },
      maxWidth: '900px',
      width: '100%',
      ax: 'center',
    },
    $localState: {
      savePost: { type: 'function', initial: null },
      submitting: { type: 'boolean', initial: false },
    },
    children: [
      { type: 'we-text', props: { variant: 'heading-md' }, children: [opts.title] },
      {
        type: 'Column',
        props: { width: '100%', bg: 'neutral-25', p: '600', pl: '1000', r: '400', overflow: 'auto' },
        children: [
          {
            type: 'BlockComposer',
            props: {
              ...(opts.editorState !== undefined ? { editorState: opts.editorState } : {}),
              perspective: { $store: 'adamStore.currentPerspective' },
              onReady: { $setLocal: 'savePost', from: '$event.save' },
              onSave: [
                { $setLocal: 'submitting', value: true },
                {
                  $action: opts.saveAction.$action,
                  args: [...opts.saveAction.args, '$arg'],
                  onSuccess: [{ $setLocal: opts.openLocal, value: false }],
                  onFinally: [{ $setLocal: 'submitting', value: false }],
                },
              ],
            },
          },
        ],
      },
      {
        type: 'Row',
        props: { gap: '300', ax: 'end', mt: '200' },
        children: [
          {
            type: 'we-button',
            props: { variant: 'ghost', text: 'Cancel', onClick: { $setLocal: opts.openLocal, value: false } },
          },
          {
            type: 'we-button',
            props: {
              text: opts.saveLabel,
              bg: 'primary-500',
              color: 'neutral-0',
              height: '40px',
              loading: { $local: 'submitting' },
              disabled: { $local: 'submitting' },
              onClick: { $callLocal: 'savePost' },
            },
          },
        ],
      },
    ],
  };
}
