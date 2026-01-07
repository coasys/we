import { PerspectiveProxy } from '@coasys/ad4m';
import { ListItemNode, ListNode } from '@lexical/list';
import { CHECK_LIST, HEADING, ORDERED_LIST, QUOTE, UNORDERED_LIST } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { Column, Row } from '@we/components/solid';
import { Block, CollectionBlock, ImageBlock, TextBlock } from '@we/models';
import { SerializedLexicalNode, SerializedRootNode } from 'lexical';
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

type BlockType = ImageBlock | TextBlock | CollectionBlock;
type Post = any; // Partial<BlockType & { children?: Post[] }> & SerializedRootNode<SerializedLexicalNode>;

type BlockComposerProps = {
  post?: Post;
  perspective: PerspectiveProxy;
};

function SaveButton({ perspective }: { perspective: PerspectiveProxy }) {
  // console.log('999 save');
  // TODO: may need to return early here if ad4mClient or perspective isnt ready
  const [editor] = useLexicalComposerContext();

  async function createBlocks(node: Post, parent?: Post, existingBatchId?: string) {
    let blockType = '';
    if (node.type === 'root') blockType = 'collection';
    if (['text', 'paragraph', 'heading', 'quote', 'list', 'listitem'].includes(node.type)) blockType = 'text';
    if (node.type === 'image') blockType = 'image';

    // Create batch
    const batchId = existingBatchId || (await perspective.createBatch());
    console.log('Creating blocks in batch:', batchId);

    // Create block
    const blockWrapper = new Block(perspective, undefined, parent?.baseExpression || undefined);
    blockWrapper.type = blockType;
    await blockWrapper.save(batchId);
    console.log('blockWrapper', blockWrapper);

    // Create collection block
    if (blockType === 'collection') {
      const elementNode = node as Post;
      const collectionBlock = new CollectionBlock(perspective, undefined, blockWrapper.baseExpression);
      collectionBlock.type = elementNode.type || '';
      collectionBlock.display = elementNode.display || '';
      collectionBlock.direction = elementNode.direction || '';
      collectionBlock.format = elementNode.format || '';
      collectionBlock.indent = elementNode.indent || 0;
      collectionBlock.version = elementNode.version || 0;
      console.log('collectionBlock', collectionBlock);
      await collectionBlock.save(batchId);
    }

    // Create text block
    if (blockType === 'text') {
      const elementNode = node as any;
      const textBlock = new TextBlock(perspective, undefined, blockWrapper.baseExpression);
      textBlock.type = elementNode.type || '';
      textBlock.direction = elementNode.direction || '';
      textBlock.format = elementNode.format || '';
      textBlock.indent = elementNode.indent || 0;
      textBlock.textFormat = elementNode.textFormat || 0;
      textBlock.textStyle = elementNode.textStyle || '';
      textBlock.listType = elementNode.listType || '';
      textBlock.start = elementNode.start || 0;
      textBlock.tag = elementNode.tag || '';
      textBlock.text = elementNode.text || '';
      textBlock.version = elementNode.version || 0;
      console.log('textBlock', textBlock);
      await textBlock.save(batchId);
    }

    if (node.type === 'image') {
      const elementNode = node as any;
      const imageBlock = new ImageBlock(perspective, undefined, blockWrapper.baseExpression);
      imageBlock.type = elementNode.type || '';
      imageBlock.src = elementNode.src || '';
      imageBlock.altText = elementNode.altText || '';
      imageBlock.width = elementNode.width || 0;
      imageBlock.height = elementNode.height || 0;
      imageBlock.version = elementNode.version || 0;
      await imageBlock.save(batchId);
      console.log('imageBlock', imageBlock);
    }

    if (node.children) {
      node.baseExpression = blockWrapper.baseExpression;
      for (const child of node.children) await createBlocks(child, node, batchId);
    }

    if (existingBatchId) return;
    // Commit batch
    console.log('Committing batch:', batchId);
    await perspective.commitBatch(batchId);
  }

  function save() {
    editor.update(async () => {
      const editorState = editor.getEditorState();
      console.log('Editor State:', editorState);
      console.log('Editor State JSON:', editorState.toJSON().root);
      const { root } = editorState.toJSON();
      console.log('Root:', root);
      console.log('Perspective:', perspective);
      if (!perspective) {
        console.error('No perspective available for saving blocks.');
        return;
      }
      await createBlocks(root);

      console.log('Saved!');
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

function LoadPostIntoEditor({ post }: { post?: Post }) {
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
