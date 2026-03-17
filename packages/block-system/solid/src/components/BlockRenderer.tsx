import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { Column } from '@we/components/solid';
import {
  ContentEditable,
  LexicalComposer,
  LexicalErrorBoundary,
  RichTextPlugin,
  useLexicalComposerContext,
} from 'lexical-solid';
import { createEffect } from 'solid-js';

import { ImageNode } from '../nodes/ImageNode';

type BlockRendererProps = {
  post?: Post;
};

function LoadPostForRenderer({ post }: { post?: Post }) {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
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

export function BlockRenderer({ post }: BlockRendererProps) {
  const initialConfig = {
    namespace: 'BlockRenderer',
    theme: { root: 'we-block-renderer' },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ImageNode] as const,
    editable: false, // If supported
    onError: (error: Error) => console.error('Renderer Error:', error),
  };

  return (
    <Column class="we-block-renderer-wrapper" bg="white" p="1000" r="xl">
      <LexicalComposer initialConfig={initialConfig}>
        <LoadPostForRenderer post={post} />
        <RichTextPlugin contentEditable={<ContentEditable readOnly={true} />} errorBoundary={LexicalErrorBoundary} />
        {/* No editing/history/custom plugins */}
      </LexicalComposer>
    </Column>
  );
}
