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

function LoadEditorState(props: { editorState?: SerializedBlockNode; perspective?: PerspectiveProxy | null }) {
  const [editor] = useLexicalComposerContext();

  // Read props.editorState/props.perspective inside the effect (not destructured
  // in the function signature) — Solid component functions run once, not on every
  // update, so destructuring here would freeze the initial value and the effect
  // would never re-run when a post is edited and the same BlockRenderer instance
  // is reused (reconcile({ key: 'id' }) deliberately keeps it mounted).
  createEffect(() => {
    const editorState = props.editorState;
    const perspective = props.perspective;
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
export function BlockRenderer(props: Props) {
  // editorState/perspective are read via props.* directly below (not destructured)
  // so LoadEditorState keeps receiving a live, reactive value when an existing
  // post is edited and this same component instance is reused — see
  // LoadEditorState's own comment for why destructuring breaks that.
  const { width = '100%', rootClass, editorState: _editorState, perspective: _perspective, ...rest } = props;
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
        <LoadEditorState editorState={props.editorState} perspective={props.perspective} />
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
