import { ListItemNode, ListNode } from '@lexical/list';
import { CHECK_LIST, HEADING, ORDERED_LIST, QUOTE, UNORDERED_LIST } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { BlockComposerProps, BlockDataset, SerializedBlockNode } from '@we/block-shared';
import { decodeEditorState, resolveExpressionAddresses } from '@we/block-shared';
import { registerCoreBlocks } from '@we/block-shared';
import type { ColumnProps } from '@we/components/solid';
import { Column, Row } from '@we/components/solid';
import { $getRoot, type LexicalEditor } from 'lexical';
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
import { createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';

import { registerCoreBlockComponents } from '../core-block-components';
import { blockNodeClasses } from '../nodes';
import { promoteBlockIdState, stampBlockIdState } from '../nodes/blockIdState';
import BlockHandlesPlugin from '../plugins/BlockHandlesPlugin';
import BlockInsertPlugin from '../plugins/BlockInsertPlugin';
import BlockKeyboardPlugin from '../plugins/BlockKeyboardPlugin';
import IndentationPlugin from '../plugins/IndentationPlugin';
import PlaceholdersPlugin from '../plugins/PlaceholdersPlugin';
import SlashCommandPlugin from '../plugins/SlashCommandPlugin';
import { useBlockDataset } from './BlockDataset';

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
  onLoaded,
}: {
  editorState?: SerializedBlockNode;
  perspective?: BlockDataset | null;
  /** Called once the loaded content is in the editor, so "unchanged" can be measured from it. */
  onLoaded?: () => void;
}) {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    if (!editorState || !editor) return;

    const rootNode: SerializedBlockNode | null =
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
        // The shared SerializedBlockNode keeps `version` optional; Lexical's root
        // requires it. Editor-produced state always carries it, so assert here.
        const lexicalState = editor.parseEditorState({ root: resolved } as Parameters<
          typeof editor.parseEditorState
        >[0]);
        editor.setEditorState(lexicalState);
        // Re-attach each existing block's AD4M id (lost on load for built-in
        // text node types — see blockIdState.ts) so saving this content back
        // can reconcile against it instead of recreating it wholesale.
        editor.update(() => {
          stampBlockIdState($getRoot(), resolved);
        });
        onLoaded?.();
      } catch (error) {
        console.error('Error loading editor state:', error);
      }
    };

    load(rootNode).catch((error) => console.error('Error resolving expression addresses:', error));
  });

  return null;
}

/**
 * Whether the document holds nothing an author would mind losing.
 *
 * "Nothing" is not the same as "no nodes": Lexical scaffolds a single empty paragraph for the
 * cursor to sit in, and a composer that has only that has not been written in. Anything else counts
 * — a second paragraph is a pressed Return, and a lone image node has no text but is certainly work.
 */
function isEmptyDocument(editor: LexicalEditor): boolean {
  return editor.getEditorState().read(() => {
    const root = $getRoot();
    if (root.getTextContent().trim() !== '') return false;
    const children = root.getChildren();
    return children.length === 0 || (children.length === 1 && children[0].getType() === 'paragraph');
  });
}

/**
 * Reports when the editor's content stops matching what it started from.
 *
 * ## Why a baseline comparison rather than Lexical's dirty flags
 *
 * `registerUpdateListener` hands over `dirtyLeaves`/`dirtyElements`, which look like the answer and
 * are not: loading a post to edit calls `setEditorState`, which marks every node dirty, so an edit
 * modal would report unsaved work before the author had touched anything. The baseline is taken
 * *after* that load — which is what `onLoaded` above exists to signal — so what is measured is the
 * author's own changes.
 *
 * ## Why a blank composer has no baseline at all
 *
 * Because there is no moment to take one. A snapshot at mount races Lexical's own initialisation:
 * the empty paragraph is inserted in an `editor.update()`, which is batched to a microtask, so
 * whether it lands before or after this plugin's `onMount` is an ordering accident — and on the
 * losing side the composer reports unsaved work the instant it opens, which is precisely the guard
 * firing when there is nothing to lose. So until something is *loaded*, "unchanged" means "still
 * empty", which no ordering can get wrong.
 *
 * ## Why it latches
 *
 * Once dirty, it stays dirty until the content is loaded again. Serialising the document to compare
 * it is cheap next to the render Lexical just did, but doing it on every keystroke of a long post
 * for the rest of the session buys only the ability to go *back* to clean by undoing everything —
 * which no editor offers, and which nobody would trust if it did.
 */
function DirtyPlugin({ loadSeq, onDirtyChange }: { loadSeq: () => number; onDirtyChange: (dirty: boolean) => void }) {
  const [editor] = useLexicalComposerContext();
  const snapshot = () => JSON.stringify(editor.getEditorState().toJSON().root);

  /** What the content was when it arrived. Null until something has been loaded — see above. */
  let baseline: string | null = null;
  let dirty = false;

  const changed = () => (baseline === null ? !isEmptyDocument(editor) : snapshot() !== baseline);

  const rebase = () => {
    baseline = snapshot();
    if (dirty) {
      dirty = false;
      onDirtyChange(false);
    }
  };

  onMount(() =>
    onCleanup(
      editor.registerUpdateListener(() => {
        if (dirty || !changed()) return;
        dirty = true;
        onDirtyChange(true);
      }),
    ),
  );

  // Taken after each programmatic load. The load's own update fires before this runs, so a brief
  // dirty is possible and self-corrects here — it happens while the modal is opening, before there
  // is anything for the author to click.
  createEffect(on(loadSeq, rebase, { defer: true }));

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
export function BlockComposer({
  editorState,
  perspective,
  onSave,
  onReady,
  onDirtyChange,
  width = '100%',
  ...rest
}: Props) {
  // The space being composed in, unless the caller named a different one. See `BlockDataset`.
  const dataset = useBlockDataset(perspective);
  // Bumped each time a programmatic load lands, so `DirtyPlugin` knows to measure from the new
  // content rather than reporting the load itself as the author's work.
  const [loadSeq, setLoadSeq] = createSignal(0);
  const initialConfig = {
    namespace: 'BlockComposer',
    theme: { root: 'we-block-composer-editor we-block-content' },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ...blockNodeClasses] as const,
    onError: (error: Error) => console.error('Editor Error:', error),
  };

  return (
    <Column class="we-block-composer-wrapper" width={width} {...rest}>
      <LexicalComposer initialConfig={initialConfig}>
        <LoadEditorState editorState={editorState} perspective={dataset} onLoaded={() => setLoadSeq((n) => n + 1)} />
        {onReady ? <OnReadyPlugin onSave={onSave} onReady={onReady} /> : <SaveButton onSave={onSave} />}
        {onDirtyChange ? <DirtyPlugin loadSeq={loadSeq} onDirtyChange={onDirtyChange} /> : null}

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
