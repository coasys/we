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
// Import collectionNodeStates from the node file (not from nodes/index to avoid
// touching the module-load order of the factory-generated node classes).
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
      console.error('CollectionInput sub-editor: error loading state', e);
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

// ── SubBlockComposer ─────────────────────────────────────────────────────────

/**
 * Lightweight nested editor — same as BlockComposer but without auto-focus
 * and without re-registering components (they're already registered when
 * BlockComposer loaded).
 */
function SubBlockComposer(props: {
  index: number;
  editorState?: SerializedBlockNode;
  onStateChange: (root: SerializedBlockNode) => void;
}) {
  const initialConfig = {
    namespace: `CollectionCell-${props.index}`,
    theme: { root: 'we-block-composer-editor we-block-content' },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ...blockNodeClasses] as const,
    onError: (error: Error) => console.error('CollectionInput sub-editor error:', error),
  };

  return (
    <div
      class="we-block-composer-wrapper we-collection-cell"
      style={{ flex: '1', 'min-width': '0', 'min-height': '80px' }}
    >
      <LexicalComposer initialConfig={initialConfig}>
        <LoadEditorState editorState={props.editorState} />
        <StateChangePlugin onStateChange={props.onStateChange} />
        <RichTextPlugin
          contentEditable={
            <div>
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

// ── CollectionInput ──────────────────────────────────────────────────────────

interface CollectionInputProps {
  /** The Lexical node key — used to write state updates to collectionNodeStates. */
  nodeKey: string;
  layout?: string;
  columnCount?: number;
  gap?: string;
  childEditorStates?: SerializedBlockNode[];
  /** Unused: state is tracked via collectionNodeStates, not via onChange. */
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

function containerStyle(layout?: string, columnCount?: number, gap?: string): Record<string, string> {
  const g = gap ? `var(--we-spacing-${gap}, 1rem)` : '1rem';
  if (layout === 'grid') {
    return {
      display: 'grid',
      'grid-template-columns': `repeat(${columnCount ?? 2}, 1fr)`,
      gap: g,
    };
  }
  if (layout === 'rows') {
    return { display: 'flex', 'flex-direction': 'column', gap: g };
  }
  // 'columns' (default)
  return {
    display: 'flex',
    'flex-direction': 'row',
    gap: g,
    'align-items': 'flex-start',
  };
}

export function CollectionInput(props: CollectionInputProps) {
  // Determine how many cells to create.
  // For 'grid', create columnCount² cells; for others, columnCount cells.
  const cellCount =
    props.childEditorStates?.length ??
    (props.layout === 'grid' ? (props.columnCount ?? 2) * (props.columnCount ?? 2) : (props.columnCount ?? 2));

  // Capture initial states once at mount — not reactive.
  // Using a plain array + static .map() renders cells exactly once.
  const initialStates: SerializedBlockNode[] = props.childEditorStates?.length
    ? [...props.childEditorStates]
    : Array.from({ length: cellCount }, () => JSON.parse(JSON.stringify(EMPTY_ROOT)));

  // Mutable tracking: updated on every sub-editor change without triggering
  // Lexical re-renders (we never call setProperty / getWritable here).
  const currentStates: SerializedBlockNode[] = [...initialStates];

  function handleStateChange(index: number, root: SerializedBlockNode) {
    currentStates[index] = root;
    collectionNodeStates.set(props.nodeKey, [...currentStates]);
  }

  return (
    <div style={containerStyle(props.layout, props.columnCount, props.gap)} class="we-collection-block">
      {initialStates.map((state, i) => (
        <SubBlockComposer index={i} editorState={state} onStateChange={(root) => handleStateChange(i, root)} />
      ))}
    </div>
  );
}
