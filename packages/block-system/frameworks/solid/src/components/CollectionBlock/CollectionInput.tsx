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
import { createEffect, For, onCleanup, Show } from 'solid-js';

import { blockNodeClasses } from '../../nodes';
import { collectionNodeStates } from '../../nodes/CollectionBlockNode';
import BlockHandlesPlugin from '../../plugins/BlockHandlesPlugin';
import BlockInsertPlugin from '../../plugins/BlockInsertPlugin';
import BlockKeyboardPlugin from '../../plugins/BlockKeyboardPlugin';
import IndentationPlugin from '../../plugins/IndentationPlugin';
import PlaceholdersPlugin from '../../plugins/PlaceholdersPlugin';
import SlashCommandPlugin from '../../plugins/SlashCommandPlugin';
import { BlockToolbar } from '../BlockToolbar';

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
  /** Used by the settings toolbar to update layout and columnCount on the node. */
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

const LAYOUT_OPTIONS = [
  { value: 'rows', icon: 'rows-plus-bottom', title: 'Stack (rows)' },
  { value: 'grid', icon: 'squares-four', title: 'Grid' },
  { value: 'columns', icon: 'columns-plus-right', title: 'Side-by-side (columns)' },
] as const;

const COL_COUNTS = [2, 3, 4] as const;

/**
 * Single sub-editor for a collection block.
 *
 * Layout is applied via data-layout on the wrapper + CSS attribute selectors,
 * so it can be changed reactively without re-mounting the Lexical editor.
 * The settings toolbar (shown when selected) lets users change layout and
 * column count via onChange → CollectionBlockBridge → node.__props update.
 */
export function CollectionInput(props: CollectionInputProps) {
  // Normalise layout name (accepts singular/plural variants)
  const layout = () => {
    const l = props.layout;
    if (l === 'column') return 'columns';
    if (l === 'row') return 'rows';
    return l ?? 'grid';
  };
  const colCount = () => props.columnCount ?? 2;
  const hasColumns = () => layout() !== 'rows';

  const initialConfig = {
    namespace: 'CollectionBlock',
    // theme.root is fixed at mount — layout changes are handled via
    // data-layout attribute + CSS attribute selectors on the wrapper.
    theme: { root: 'we-block-composer-editor we-block-content' },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ...blockNodeClasses] as const,
    onError: (error: Error) => console.error('CollectionInput error:', error),
  };

  function stop(e: MouseEvent) {
    e.stopPropagation();
  }

  return (
    <div
      class="we-collection-block"
      data-layout={layout()}
      style={{
        '--we-cols': String(colCount()),
        '--we-gap': props.gap ? `var(--we-spacing-${props.gap}, 1rem)` : '1rem',
        position: 'relative',
      }}
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

      {/* Settings toolbar — floats above the block so it never obscures content */}
      <Show when={props.isSelected()}>
        <BlockToolbar placement="above">
          {/* Layout toggles */}
          <For each={LAYOUT_OPTIONS}>
            {(opt) => (
              <we-button
                square
                variant={layout() === opt.value ? 'secondary' : 'ghost'}
                onClick={(e: MouseEvent) => {
                  console.log('Setting layout to', opt.value);
                  stop(e);
                  console.log('Calling props.onChange with', opt.value);
                  props.onChange('layout', opt.value);
                }}
              >
                <we-icon name={opt.icon} size="xs" />
              </we-button>
            )}
          </For>

          {/* Column count — only relevant for grid / columns layouts */}
          <Show when={hasColumns()}>
            <we-divider orientation="vertical" my="300" mx="100" color="neutral-100" />
            <For each={COL_COUNTS}>
              {(n) => (
                <we-button
                  square
                  variant={colCount() === n ? 'secondary' : 'ghost'}
                  onClick={(e: MouseEvent) => {
                    stop(e);
                    props.onChange('columnCount', n);
                  }}
                >
                  {n}
                </we-button>
              )}
            </For>
          </Show>
        </BlockToolbar>
      </Show>
    </div>
  );
}
