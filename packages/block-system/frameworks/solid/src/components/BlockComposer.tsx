import { PerspectiveProxy } from '@coasys/ad4m';
import { ListItemNode, ListNode } from '@lexical/list';
import { CHECK_LIST, HEADING, ORDERED_LIST, QUOTE, UNORDERED_LIST } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { BlockComposerProps, SerializedBlockNode } from '@we/block-shared';
import { createBlocks } from '@we/block-shared';
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
import { createEffect } from 'solid-js';

import { ImageNode } from '../nodes/ImageNode';
import BlockHandlesPlugin from '../plugins/BlockHandlesPlugin';
import ImagePlugin from '../plugins/ImageBlockPlugin';
import IndentationPlugin from '../plugins/IndentationPlugin';
import PlaceholdersPlugin from '../plugins/PlaceholdersPlugin';
import SlashCommandPlugin from '../plugins/SlashCommandPlugin';

function SaveButton({ perspective }: { perspective: PerspectiveProxy }) {
  const [editor] = useLexicalComposerContext();

  function save() {
    editor.update(async () => {
      const editorState = editor.getEditorState();
      const { root } = editorState.toJSON();
      if (!perspective) {
        console.error('No perspective available for saving blocks.');
        return;
      }
      await createBlocks(perspective, root);
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

// question abgout ds component vs block distinction (especially for external devs)

function LoadPostIntoEditor({ post }: { post?: SerializedBlockNode }) {
  // console.log('888 LoadPostIntoEditor post:', post);
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

export function BlockComposer({ post, perspective }: BlockComposerProps) {
  console.log('*** BlockComposer rendered. post:', post);
  const initialConfig = {
    namespace: 'BlockComposer',
    theme: { root: 'we-block-composer-editor' },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ImageNode] as const,
    onError: (error: Error) => console.error('Editor Error:', error),
  };
  console.log('*** BlockComposer initialConfig:', initialConfig);

  return (
    <Column class="we-block-composer-wrapper" bg="white" p="1000" r="xl">
      <LexicalComposer initialConfig={initialConfig}>
        <LoadPostIntoEditor post={post} />
        <SaveButton perspective={perspective} />

        {/* Lexical plugins */}
        <RichTextPlugin contentEditable={<ContentEditable />} errorBoundary={LexicalErrorBoundary} />
        <LexicalMarkdownShortcutPlugin transformers={[HEADING, QUOTE, UNORDERED_LIST, ORDERED_LIST, CHECK_LIST]} />
        <HistoryPlugin />
        <ListPlugin />

        {/* Custom plugins */}
        <BlockHandlesPlugin />
        <PlaceholdersPlugin />
        <SlashCommandPlugin />
        <IndentationPlugin />
        <ImagePlugin />
      </LexicalComposer>
    </Column>
  );
}
