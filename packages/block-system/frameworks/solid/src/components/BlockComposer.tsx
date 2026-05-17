import { ListItemNode, ListNode } from '@lexical/list';
import { CHECK_LIST, HEADING, ORDERED_LIST, QUOTE, UNORDERED_LIST } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { BlockComposerProps, SerializedBlockNode } from '@we/block-shared';
import { registerCoreBlocks } from '@we/block-shared';
import type { ColumnProps } from '@we/components/solid';
import { Column, Row } from '@we/components/solid';
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
import { createEffect, onMount } from 'solid-js';

import { registerCoreBlockComponents } from '../core-block-components';
import { blockNodeClasses } from '../nodes';
import BlockHandlesPlugin from '../plugins/BlockHandlesPlugin';
import BlockInsertPlugin from '../plugins/BlockInsertPlugin';
import IndentationPlugin from '../plugins/IndentationPlugin';
import PlaceholdersPlugin from '../plugins/PlaceholdersPlugin';
import SlashCommandPlugin from '../plugins/SlashCommandPlugin';

registerCoreBlocks();
registerCoreBlockComponents();

function SaveButton({ onSave }: { onSave?: (json: SerializedBlockNode) => void }) {
  const [editor] = useLexicalComposerContext();

  function save() {
    editor.update(() => {
      const editorState = editor.getEditorState();
      const { root } = editorState.toJSON();
      if (onSave) {
        onSave(root);
      } else {
        console.error('BlockComposer: no onSave callback provided.');
      }
    });
  }

  return (
    <Row ax="end">
      <we-button onClick={save}>
        <we-icon name="floppy-disk" />
      </we-button>
    </Row>
  );
}

function LoadPostIntoEditor({ post }: { post?: SerializedBlockNode }) {
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

/** Focuses the editor after the next frame so the modal/DOM is fully settled. */
function DeferredAutoFocusPlugin() {
  const [editor] = useLexicalComposerContext();

  onMount(() => {
    requestAnimationFrame(() => {
      editor.focus(
        () => {
          const rootElement = editor.getRootElement();
          if (rootElement && document.activeElement !== rootElement) {
            rootElement.focus({ preventScroll: true });
          }
        },
        { defaultSelection: 'rootStart' },
      );
    });
  });

  return null;
}

/** Calls onReady with a save API after the editor mounts. */
function OnReadyPlugin({
  onSave,
  onReady,
}: {
  onSave?: (json: SerializedBlockNode) => void;
  onReady: (api: { save: () => void }) => void;
}) {
  const [editor] = useLexicalComposerContext();

  onMount(() => {
    const save = () => {
      editor.update(() => {
        const editorState = editor.getEditorState();
        const { root } = editorState.toJSON();
        if (onSave) {
          onSave(root);
        } else {
          console.error('BlockComposer: no onSave callback provided.');
        }
      });
    };
    onReady({ save });
  });

  return null;
}

type Props = Omit<BlockComposerProps, 'ax' | 'ay'> & Pick<ColumnProps, 'ax' | 'ay'>;

/** @superclass DesignSystemElement */
export function BlockComposer({ post, onSave, onReady, width = '100%', ...rest }: Props) {
  const initialConfig = {
    namespace: 'BlockComposer',
    theme: { root: 'we-block-composer-editor we-block-content' },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ...blockNodeClasses] as const,
    onError: (error: Error) => console.error('Editor Error:', error),
  };

  return (
    <Column class="we-block-composer-wrapper" width={width} {...rest}>
      <LexicalComposer initialConfig={initialConfig}>
        <LoadPostIntoEditor post={post} />
        {onReady ? <OnReadyPlugin onSave={onSave} onReady={onReady} /> : <SaveButton onSave={onSave} />}

        {/* Lexical plugins */}
        <RichTextPlugin contentEditable={<div><ContentEditable /></div>} errorBoundary={LexicalErrorBoundary} />
        <LexicalMarkdownShortcutPlugin transformers={[HEADING, QUOTE, UNORDERED_LIST, ORDERED_LIST, CHECK_LIST]} />
        <HistoryPlugin />
        <ListPlugin />
        <DeferredAutoFocusPlugin />

        {/* Custom plugins */}
        <BlockHandlesPlugin />
        <PlaceholdersPlugin />
        <SlashCommandPlugin />
        <IndentationPlugin />
        <BlockInsertPlugin />
      </LexicalComposer>
    </Column>
  );
}
