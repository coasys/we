import type { PerspectiveProxy } from '@coasys/ad4m';
import { ListItemNode, ListNode } from '@lexical/list';
import { CHECK_LIST, HEADING, ORDERED_LIST, QUOTE, UNORDERED_LIST } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { BlockComposerProps, SerializedBlockNode } from '@we/block-shared';
import { decodeEditorState, resolveExpressionAddresses } from '@we/block-shared';
import { registerCoreBlocks } from '@we/block-shared';
import type { ColumnProps } from '@we/components/solid';
import { Column, Row } from '@we/components/solid';
import { $getRoot } from 'lexical';
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
import { promoteBlockIdState, stampBlockIdState } from '../nodes/blockIdState';
import BlockHandlesPlugin from '../plugins/BlockHandlesPlugin';
import BlockInsertPlugin from '../plugins/BlockInsertPlugin';
import BlockKeyboardPlugin from '../plugins/BlockKeyboardPlugin';
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
        onSave(promoteBlockIdState(root));
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
      // Resolve stored file-storage addresses (e.g. an image's CID) to
      // renderable data URIs first — same as BlockRenderer does for
      // read-only display. Without this, an existing post's image src is
      // still its address ("qm...://Qm...") when loaded into the editor,
      // which the browser can't render as <img src>.
      const resolved = perspective ? await resolveExpressionAddresses(perspective, node) : node;
      try {
        const lexicalState = editor.parseEditorState({ root: resolved });
        editor.setEditorState(lexicalState);
        // Re-attach each existing block's AD4M id (lost on load for built-in
        // text node types — see blockIdState.ts) so saving this content back
        // can reconcile against it instead of recreating it wholesale.
        editor.update(() => {
          stampBlockIdState($getRoot(), resolved);
        });
      } catch (error) {
        console.error('Error loading editor state:', error);
      }
    };

    load(rootNode).catch((error) => console.error('Error resolving expression addresses:', error));
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
          onSave(promoteBlockIdState(root));
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
export function BlockComposer({ editorState, perspective, onSave, onReady, width = '100%', ...rest }: Props) {
  const initialConfig = {
    namespace: 'BlockComposer',
    theme: { root: 'we-block-composer-editor we-block-content' },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ...blockNodeClasses] as const,
    onError: (error: Error) => console.error('Editor Error:', error),
  };

  return (
    <Column class="we-block-composer-wrapper" width={width} {...rest}>
      <LexicalComposer initialConfig={initialConfig}>
        <LoadEditorState editorState={editorState} perspective={perspective} />
        {onReady ? <OnReadyPlugin onSave={onSave} onReady={onReady} /> : <SaveButton onSave={onSave} />}

        {/* Lexical plugins */}
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
        <DeferredAutoFocusPlugin />

        {/* Custom plugins */}
        <BlockHandlesPlugin />
        <PlaceholdersPlugin />
        <SlashCommandPlugin />
        <IndentationPlugin />
        <BlockInsertPlugin />
        <BlockKeyboardPlugin />
      </LexicalComposer>
    </Column>
  );
}
