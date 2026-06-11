import type { PerspectiveProxy } from '@coasys/ad4m';
import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { BlockRendererProps, SerializedBlockNode } from '@we/block-shared';
import { decodeEditorState, resolveExpressionAddresses } from '@we/block-shared';
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

type Props = Omit<BlockRendererProps, 'ax' | 'ay'> & Pick<ColumnProps, 'ax' | 'ay'> & { rootClass?: string };

function LoadEditorState({
  editorState,
  perspective,
}: {
  editorState?: SerializedBlockNode;
  perspective?: PerspectiveProxy | null;
}) {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    if (!editorState || !editor) return;

    const rootNode: SerializedBlockNode =
      typeof editorState === 'string' ? decodeEditorState(editorState) : editorState;
    if (!rootNode) return;

    const load = async (node: SerializedBlockNode) => {
      const resolved = perspective ? await resolveExpressionAddresses(perspective, node) : node;
      try {
        const lexicalState = editor.parseEditorState({ root: resolved });
        editor.setEditorState(lexicalState);
      } catch (error) {
        console.error('Error loading editor state:', error);
      }
    };

    load(rootNode).catch((error) => console.error('Error resolving expression addresses:', error));
  });

  return null;
}

/** @superclass DesignSystemElement */
export function BlockRenderer({ editorState, perspective, width = '100%', rootClass, ...rest }: Props) {
  const themeRoot = rootClass
    ? `we-block-renderer we-block-content ${rootClass}`
    : 'we-block-renderer we-block-content';
  const initialConfig = {
    namespace: 'BlockRenderer',
    theme: { root: themeRoot },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ...blockNodeClasses] as const,
    editable: false, // If supported
    onError: (error: Error) => console.error('Renderer Error:', error),
  };

  return (
    <Column class="we-block-renderer-wrapper" width={width} {...rest}>
      <LexicalComposer initialConfig={initialConfig}>
        <LoadEditorState editorState={editorState} perspective={perspective} />
        <RichTextPlugin
          contentEditable={
            <div>
              <ContentEditable readOnly={true} />
            </div>
          }
          errorBoundary={LexicalErrorBoundary}
        />
        {/* No editing/history/custom plugins */}
      </LexicalComposer>
    </Column>
  );
}
