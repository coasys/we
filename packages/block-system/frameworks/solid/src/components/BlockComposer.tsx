import type { BlockComposerProps, ContentBlock, ContentDocument, MentionCandidate } from '@we/block-shared';
import {
  collectKeys,
  decodeEditorState,
  emptyContent,
  getRegisteredBlockModels,
  registerCoreBlocks,
  resolveExpressionAddresses,
} from '@we/block-shared';
import type { ColumnProps } from '@we/components/solid';
import { Column } from '@we/components/solid';
import { gapCursor } from 'prosemirror-gapcursor';
import { history } from 'prosemirror-history';
import type { Schema } from 'prosemirror-model';
import { EditorState, type Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createEffect, createSignal, on, onCleanup, onMount, Show, useContext } from 'solid-js';
import { Portal } from 'solid-js/web';

import { registerCoreBlockComponents } from '../core-block-components';
import { menuTypeOf, toggleChecked, transformBlock } from '../editor/commands';
import type { EditorContext } from '../editor/context';
import { contentToDoc, docToContent } from '../editor/converter';
import { nodeViewsFor } from '../editor/nodeViews';
import { blockChromePlugin } from '../editor/plugins/blockChrome';
import { BlockHandles } from '../editor/plugins/blockHandles';
import { FormattingToolbar } from '../editor/plugins/formattingToolbar';
import { composerInputRules } from '../editor/plugins/inputRules';
import { baseKeymapPlugin, composerKeymap } from '../editor/plugins/keymap';
import { linksPlugin } from '../editor/plugins/links';
import { MentionMenu, mentionsPlugin } from '../editor/plugins/mentions';
import { placeholdersPlugin } from '../editor/plugins/placeholders';
import { slashCommandPlugin } from '../editor/plugins/slashCommand';
import { createBlockSchema, MENTION_NODE, UNKNOWN_NODE } from '../editor/schema';
import { DisplayOverridesContext } from './BlockDisplayOverrides';
import { useBlockHost } from './BlockHost';
import BlockMenu from './BlockMenu';

registerCoreBlocks();
registerCoreBlockComponents();

/** The custom block types the registry knows, for building a schema. */
function registeredCustomTypes(): string[] {
  const types = new Set<string>();
  for (const reg of getRegisteredBlockModels()) for (const t of reg.nodeTypes) types.add(t);
  types.delete('root');
  types.delete('collection');
  types.delete('block');
  return [...types];
}

let cachedSchema: { key: string; schema: Schema } | null = null;

/** One schema per set of registered types — rebuilt only when a block type is registered later. */
export function getBlockSchema(): Schema {
  const types = registeredCustomTypes().sort();
  const key = types.join(',');
  if (!cachedSchema || cachedSchema.key !== key) cachedSchema = { key, schema: createBlockSchema(types) };
  return cachedSchema.schema;
}

/** Custom node names a schema has — the ones that get a node view. */
function customNodeNames(schema: Schema): string[] {
  return Object.values(schema.nodes)
    .filter(
      (t) =>
        t.isAtom && t.name !== MENTION_NODE && t.name !== UNKNOWN_NODE && t.name !== 'hard_break' && t.name !== 'text',
    )
    .map((t) => t.name);
}

type Props = Omit<BlockComposerProps, 'ax' | 'ay'> & Pick<ColumnProps, 'ax' | 'ay'>;

/**
 * The composer: one ProseMirror document per composition, blocks as nodes, WE's chrome as plugins
 * and overlays. Same props and the same pull-based save handshake as before — templates do not
 * notice the editor changed.
 *
 * @superclass DesignSystemElement
 */
export function BlockComposer(props: Props) {
  const host = useBlockHost();
  const overrides = useContext(DisplayOverridesContext);
  const { width = '100%' } = props;

  let mountEl: HTMLDivElement | undefined;
  const [view, setView] = createSignal<EditorView | null>(null);
  const [version, setVersion] = createSignal(0);
  const [activeDom, setActiveDom] = createSignal<HTMLElement | null>(null);
  const [menu, setMenu] = createSignal<{ pos: number; anchor: { top: number; left: number }; nodeType: string } | null>(
    null,
  );
  const [linkPrompt, setLinkPrompt] = createSignal(false);

  /** Keys of the blocks that were loaded — what a save reports as its base. */
  let baseKeys: string[] = [];
  /** The document as loaded, for change detection; null until something is loaded. */
  let baseline: string | null = null;
  let dirty = false;

  const mentions = (): MentionCandidate[] => props.mentions ?? host.mentions();

  const ctx: EditorContext = {
    view,
    version,
    activeDom,
    mentions,
    displayOverrides: overrides,
    openBlockMenu: (pos, anchor) => {
      const v = view();
      const node = v?.state.doc.nodeAt(pos);
      if (!v || !node) return;
      setMenu({ pos, anchor, nodeType: menuTypeOf(node) });
    },
    requestLink: () => setLinkPrompt(true),
  };

  /** Whether the document holds nothing an author would mind losing: at most one empty paragraph. */
  function isEmptyDocument(v: EditorView): boolean {
    const { doc } = v.state;
    if (doc.textContent.trim() !== '') return false;
    return (
      doc.childCount === 0 ||
      (doc.childCount === 1 && doc.firstChild!.type.name === 'paragraph' && doc.firstChild!.content.size === 0)
    );
  }

  function checkDirty(v: EditorView) {
    if (!props.onDirtyChange || dirty) return;
    const changed = baseline === null ? !isEmptyDocument(v) : JSON.stringify(v.state.doc.toJSON()) !== baseline;
    if (changed) {
      dirty = true;
      props.onDirtyChange(true);
    }
  }

  function rebase(v: EditorView) {
    baseline = JSON.stringify(v.state.doc.toJSON());
    if (dirty) {
      dirty = false;
      props.onDirtyChange?.(false);
    }
  }

  function save() {
    const v = view();
    if (!v) return;
    const document: ContentDocument = { _type: 'document', blocks: docToContent(v.state.doc), base: baseKeys };
    if (props.onSave) props.onSave(document);
    else console.error('BlockComposer: no onSave callback provided.');
  }

  function plugins(schema: Schema): Plugin[] {
    return [
      mentionsPlugin(),
      slashCommandPlugin(ctx),
      composerInputRules(schema),
      composerKeymap(schema, { requestLink: ctx.requestLink }),
      baseKeymapPlugin(),
      history(),
      gapCursor(),
      linksPlugin(),
      blockChromePlugin(),
      placeholdersPlugin(),
    ];
  }

  async function load(v: EditorView, input: BlockComposerProps['editorState']) {
    const schema = v.state.schema;
    let blocks: ContentBlock[] = input === undefined ? emptyContent() : (decodeEditorState(input) ?? emptyContent());
    // Resolve stored file-storage addresses (an image's CID) to renderable data URIs first —
    // without this, an existing post's image src is still its address when loaded into the editor.
    const dataset = host.dataset() ?? props.perspective ?? null;
    if (dataset) {
      try {
        blocks = await resolveExpressionAddresses(dataset, blocks);
      } catch (error) {
        console.error('BlockComposer: error resolving expression addresses', error);
      }
    }
    const doc = contentToDoc(schema, blocks);
    v.updateState(EditorState.create({ schema, doc, plugins: v.state.plugins }));
    baseKeys = collectKeys(blocks);
    rebase(v);
    setVersion((n) => n + 1);
  }

  onMount(() => {
    if (!mountEl) return;
    const schema = getBlockSchema();
    const state = EditorState.create({ schema, doc: contentToDoc(schema, emptyContent()), plugins: plugins(schema) });
    const v = new EditorView(mountEl, {
      state,
      nodeViews: nodeViewsFor(customNodeNames(schema), ctx),
      attributes: { class: 'we-block-composer-editor we-block-content' },
      dispatchTransaction(tr) {
        const next = v.state.apply(tr);
        v.updateState(next);
        setVersion((n) => n + 1);
        if (tr.docChanged) checkDirty(v);
      },
      handleDOMEvents: {
        focus: () => {
          setVersion((n) => n + 1);
          return false;
        },
        blur: () => {
          setVersion((n) => n + 1);
          return false;
        },
      },
      handleClickOn(view, _pos, node, nodePos, event) {
        // The marker zone of a check-list item flips its state.
        if (node.type.name === 'list_item' && node.attrs.listType === 'check') {
          const dom = view.nodeDOM(nodePos) as HTMLElement | null;
          if (dom && event.clientX < dom.getBoundingClientRect().left + 32) return toggleChecked(view, nodePos);
        }
        return false;
      },
    });
    setView(v);

    // One listener for every block: which wrapper the pointer last went down in, so a block whose
    // input holds focus can show its toolbar without the editor's selection moving.
    const onMouseDown = (e: MouseEvent) => {
      const path = e.composedPath();
      const wrapper = path.find(
        (el) => el instanceof HTMLElement && el.classList.contains('we-block') && v.dom.contains(el),
      ) as HTMLElement | undefined;
      setActiveDom(wrapper ?? null);
    };
    document.addEventListener('mousedown', onMouseDown, true);

    props.onReady?.({ save });

    // Focus after the next frame so the modal/DOM is fully settled.
    requestAnimationFrame(() => {
      if (!v.isDestroyed) v.focus();
    });

    onCleanup(() => {
      document.removeEventListener('mousedown', onMouseDown, true);
      v.destroy();
      setView(null);
    });
  });

  // Load whenever the content changes — including when the same instance is reused for another
  // post, which `reconcile({ key: 'id' })` in a list deliberately does.
  createEffect(
    on(
      () => [view(), props.editorState] as const,
      ([v, input]) => {
        if (!v) return;
        if (input === undefined && baseline === null) return; // a fresh composer starts empty already
        void load(v, input);
      },
    ),
  );

  return (
    <Column class="we-block-composer-wrapper" width={width} ax={props.ax} ay={props.ay}>
      <div ref={mountEl} class="we-block-composer-mount" />
      <Show when={view()}>
        <BlockHandles ctx={ctx} />
        <MentionMenu ctx={ctx} />
        <FormattingToolbar ctx={ctx} linkPrompt={linkPrompt} setLinkPrompt={setLinkPrompt} />
        <Show when={!props.onReady}>
          <div class="we-block-composer-save">
            <we-button onClick={save}>
              <we-icon name="floppy-disk" />
            </we-button>
          </div>
        </Show>
        <Show when={menu()}>
          {(m) => (
            <Portal>
              <BlockMenu
                nodeType={m().nodeType}
                position={m().anchor}
                selectType={(type) => {
                  const v = view();
                  if (v) transformBlock(v, m().pos, type);
                }}
                close={() => {
                  setMenu(null);
                  view()?.focus();
                }}
              />
            </Portal>
          )}
        </Show>
      </Show>
    </Column>
  );
}
