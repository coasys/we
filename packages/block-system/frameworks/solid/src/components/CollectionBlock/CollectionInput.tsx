import { ListItemNode, ListNode } from '@lexical/list';
import { CHECK_LIST, HEADING, ORDERED_LIST, QUOTE, UNORDERED_LIST } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { SerializedBlockNode } from '@we/block-shared';
import { registerCoreBlocks } from '@we/block-shared';
import {
  ContentEditable,
  HistoryPlugin,
  LexicalComposer,
  LexicalErrorBoundary,
  LexicalMarkdownShortcutPlugin,
  ListPlugin,
  RichTextPlugin,
  useLexicalComposerContext,
} from 'lexical-solid';
import { createEffect, onCleanup } from 'solid-js';

import { blockNodeClasses } from '../../nodes';
import { collectionNodeStates } from '../../nodes/CollectionBlockNode';
import BlockHandlesPlugin from '../../plugins/BlockHandlesPlugin';
import BlockInsertPlugin from '../../plugins/BlockInsertPlugin';
import BlockKeyboardPlugin from '../../plugins/BlockKeyboardPlugin';
import IndentationPlugin from '../../plugins/IndentationPlugin';
import PlaceholdersPlugin from '../../plugins/PlaceholdersPlugin';
import SlashCommandPlugin from '../../plugins/SlashCommandPlugin';

// Ensure core block models are registered for sub-editor node types
registerCoreBlocks();

const EMPTY_ROOT: SerializedBlockNode = {
  type: 'root',
  children: [{ type: 'paragraph', children: [], direction: null, format: '', indent: 0, version: 1 }],
  direction: null,
  format: '',
  indent: 0,
  version: 1,
};

// ── Internal Lexical plugins ─────────────────────────────────────────────────

function LoadEditorState({ editorState }: { editorState?: SerializedBlockNode }) {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    if (!editorState || !editor) return;
    try {
      const state = editor.parseEditorState({ root: editorState });
      editor.setEditorState(state);
    } catch (e) {
      console.error('CollectionInput: error loading state', e);
    }
  });

  return null;
}

function StateChangePlugin({ onStateChange }: { onStateChange: (root: SerializedBlockNode) => void }) {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      const { root } = editorState.toJSON();
      onStateChange(root);
    });
    onCleanup(unregister);
  });

  return null;
}

// ── CollectionInput ──────────────────────────────────────────────────────────

interface CollectionInputProps {
  /** The Lexical node key — used to write state updates to collectionNodeStates. */
  nodeKey: string;
  layout?: string;
  columnCount?: number;
  gap?: string;
  childEditorState?: SerializedBlockNode;
  /** Unused: state is tracked via collectionNodeStates, not via onChange. */
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

/** Returns the Lexical root class that applies the grid layout. */
function layoutRootClass(layout?: string): string {
  if (layout === 'columns' || layout === 'grid') return 'we-collection-layout';
  return ''; // 'rows' — default stacking
}

/**
 * Single sub-editor for a collection block.
 *
 * Each block added inside it becomes a grid cell (when layout is 'columns' or
 * 'grid') via display:grid on the Lexical editor root.  The self-similar
 * design mirrors the root composition: one editor state, standard block nodes,
 * no per-cell sub-editors.  Users nest another collection block to get a
 * multi-block cell.
 */
export function CollectionInput(props: CollectionInputProps) {
  const colCount = props.columnCount ?? 2;
  const rootClass = layoutRootClass(props.layout);

  const initialConfig = {
    namespace: 'CollectionBlock',
    theme: {
      root: `we-block-composer-editor we-block-content${rootClass ? ` ${rootClass}` : ''}`,
    },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ...blockNodeClasses] as const,
    onError: (error: Error) => console.error('CollectionInput error:', error),
  };

  return (
    <div
      // CSS custom properties cascade into the editor root for we-collection-layout
      style={{
        '--we-cols': String(colCount),
        '--we-gap': props.gap ? `var(--we-spacing-${props.gap}, 1rem)` : '1rem',
      }}
      class="we-collection-block"
    >
      <LexicalComposer initialConfig={initialConfig}>
        <LoadEditorState editorState={props.childEditorState ?? EMPTY_ROOT} />
        <StateChangePlugin
          onStateChange={(root) => {
            collectionNodeStates.set(props.nodeKey, root);
          }}
        />
        <RichTextPlugin
          contentEditable={
            <div class="we-block-composer-wrapper">
              <ContentEditable />
            </div>
          }
          errorBoundary={LexicalErrorBoundary}
        />
        <LexicalMarkdownShortcutPlugin transformers={[HEADING, QUOTE, UNORDERED_LIST, ORDERED_LIST, CHECK_LIST]} />
        <HistoryPlugin />
        <ListPlugin />
        <BlockHandlesPlugin />
        <PlaceholdersPlugin />
        <SlashCommandPlugin />
        <IndentationPlugin />
        <BlockInsertPlugin />
        <BlockKeyboardPlugin />
      </LexicalComposer>
    </div>
  );
}

// Ensure core block models are registered for sub-editor node types
registerCoreBlocks();
