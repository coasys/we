import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { BlockRendererProps, SerializedBlockNode } from '@we/block-shared';
import type { ColumnProps } from '@we/components/solid';
import { Column } from '@we/components/solid';
import {
  ContentEditable,
  LexicalComposer,
  LexicalErrorBoundary,
  RichTextPlugin,
  useLexicalComposerContext,
} from 'lexical-solid';
import { createEffect } from 'solid-js';

import { blockNodeClasses } from '../nodes';

type Props = Omit<BlockRendererProps, 'ax' | 'ay'> & Pick<ColumnProps, 'ax' | 'ay'>;

function LoadPostForRenderer({ post }: { post?: SerializedBlockNode }) {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    console.log('post data for renderer', post);
    if (!post || !editor) return;
    try {
      const editorState = editor.parseEditorState({ root: post });
      editor.setEditorState(editorState);
    } catch (error) {
      console.error('Error loading post data:', error);
    }
  });

  return null;
}

/** @superclass DesignSystemElement */
export function BlockRenderer({ post, width = '100%', ...rest }: Props) {
  const initialConfig = {
    namespace: 'BlockRenderer',
    theme: { root: 'we-block-renderer we-block-content' },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ...blockNodeClasses] as const,
    editable: false, // If supported
    onError: (error: Error) => console.error('Renderer Error:', error),
  };

  return (
    <Column class="we-block-renderer-wrapper" width={width} {...rest}>
      <LexicalComposer initialConfig={initialConfig}>
        <LoadPostForRenderer post={post} />
        <RichTextPlugin contentEditable={<ContentEditable readOnly={true} />} errorBoundary={LexicalErrorBoundary} />
        {/* No editing/history/custom plugins */}
      </LexicalComposer>
    </Column>
  );
}
