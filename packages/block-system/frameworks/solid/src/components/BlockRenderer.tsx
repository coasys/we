import type { BlockDragSource, BlockRendererProps, ContentBlock, TextContentBlock } from '@we/block-shared';
import {
  decodeEditorState,
  getBlockRegistration,
  isCollectionBlock,
  isTextBlock,
  registerCoreBlocks,
  resolveExpressionAddresses,
} from '@we/block-shared';
import type { ColumnProps } from '@we/components/solid';
import { Column } from '@we/components/solid';
import { DOMSerializer } from 'prosemirror-model';
import type { JSX } from 'solid-js';
import { createContext, createMemo, createResource, For, Match, Show, Switch, useContext } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import { registerCoreBlockComponents } from '../core-block-components';
import { blockToNode } from '../editor/converter';
import { getBlockSchema } from './BlockComposer';
import { useDisplayOverride } from './BlockDisplayOverrides';
import { useBlockHost } from './BlockHost';
import { CollectionDisplay } from './CollectionBlock/CollectionDisplay';
import { FallbackBlockCard } from './FallbackBlockCard/FallbackBlockCard';

registerCoreBlocks();
registerCoreBlockComponents();

type Props = Omit<BlockRendererProps, 'ax' | 'ay'> & Pick<ColumnProps, 'ax' | 'ay'> & { rootClass?: string };

let serializer: DOMSerializer | null = null;
function domSerializer(): DOMSerializer {
  const schema = getBlockSchema();
  if (!serializer || serializer.nodes !== DOMSerializer.fromSchema(schema).nodes)
    serializer = DOMSerializer.fromSchema(schema);
  return serializer;
}

/**
 * A text block as the exact DOM the composer would render it as — the schema's `toDOM` is the one
 * definition, so the two cannot drift. No editor is instantiated: this is a serializer over a node.
 */
function TextBlockElement(props: { block: TextContentBlock }): JSX.Element {
  const element = createMemo(() => {
    const node = blockToNode(getBlockSchema(), props.block);
    return node ? (domSerializer().serializeNode(node) as HTMLElement) : null;
  });
  return <>{element()}</>;
}

/** Whether, and as what, the blocks being walked can be picked up. Absent: they cannot. */
const BlockDragContext = createContext<BlockDragSource | undefined>(undefined);

/** A block's entity — the record a drag names. */
function entityOf(block: ContentBlock): string | undefined {
  return isTextBlock(block) ? 'TextBlock' : getBlockRegistration(block._type)?.entity;
}

/** What the ghost says, and what the Pocket writes down: the words, or whatever names the thing. */
function labelOf(block: ContentBlock): string {
  if (isTextBlock(block)) {
    const text = (block.text ?? '').trim();
    return text.length > 80 ? `${text.slice(0, 79)}…` : text || 'Text';
  }
  const fields = block as unknown as Record<string, unknown>;
  for (const key of ['title', 'label', 'name', 'altText', 'url']) {
    if (typeof fields[key] === 'string' && fields[key]) return fields[key] as string;
  }
  return entityOf(block) ?? block._type;
}

const ICONS: Record<string, string> = {
  block: 'text-align-left',
  image: 'image',
  video: 'video',
  audio: 'speaker-high',
  file: 'file',
  link: 'link',
  embed: 'bookmark-simple',
  task: 'check-square',
  event: 'calendar',
  location: 'map-pin',
  code: 'code',
  callout: 'info',
};

/** A picture standing for the block, where it has one. Already resolved to a data URI by the renderer. */
function thumbnailOf(block: ContentBlock): string | undefined {
  const fields = block as unknown as Record<string, unknown>;
  const picture = block._type === 'image' ? fields.src : fields.thumbnail;
  return typeof picture === 'string' && picture ? picture : undefined;
}

/**
 * One block that can be picked up by itself.
 *
 * A grip in the block's left padding, shown on hover and on focus, is the handle a paragraph needs:
 * its words are for selecting. A block with nothing to select — a picture — can be taken by the
 * picture as well, since the whole wrapper is the draggable and only a press on glyphs declines.
 *
 * The grip is a focusable span rather than a button: `we-draggable` refuses presses that begin in a
 * button, and the grip is exactly where a press should begin. Space on it picks the block up.
 */
function DraggableBlock(props: { block: ContentBlock; children: JSX.Element }): JSX.Element {
  const source = useContext(BlockDragContext);
  const entity = () => entityOf(props.block);
  const preview = () => ({
    thumbnail: thumbnailOf(props.block),
    author: source?.author,
    source: source?.source,
  });
  return (
    <Show when={source && props.block._key && entity()} fallback={props.children}>
      {/* `prop:` for the camel-cased members: without it Solid writes an attribute, and a lower-cased
          `recordid` attribute is not the property the element reads. Objects are set as properties
          already. The test in blockRendererDrag.test.tsx holds this. */}
      <we-draggable
        entity={entity()!}
        prop:recordId={props.block._key!}
        prop:datasetKey={source!.datasetKey ?? ''}
        label={labelOf(props.block)}
        icon={ICONS[props.block._type] ?? 'square'}
        preview={preview()}
        within={{ entity: 'CollectionBlock', id: source!.within }}
      >
        <div class="we-block-draggable">
          <span class="we-block-grip" role="button" tabindex="0" aria-label="Drag this block" data-we-id="grip">
            <we-icon name="dots-six-vertical" size="12px" />
          </span>
          {props.children}
        </div>
      </we-draggable>
    </Show>
  );
}

function CustomBlockElement(props: { block: ContentBlock }): JSX.Element {
  const Override = useDisplayOverride(props.block._type);
  const Display = () =>
    Override ??
    (getBlockRegistration(props.block._type)?.display as ((p: Record<string, unknown>) => JSX.Element) | undefined);
  const fields = () => {
    const { _type: _t, _key, ...rest } = props.block;
    // A block's key is its record id (see `serialization.ts`). Handed on as `id` so a display that
    // asks about the record — a module's declared card querying its votes — can name it; the core
    // displays take named props and ignore an extra one.
    return 'id' in rest ? rest : { ...rest, ...(_key ? { id: _key } : {}) };
  };
  return (
    <div class="we-block" data-block-type={props.block._type}>
      <Switch fallback={<FallbackBlockCard block={fields()} type={props.block._type} />}>
        <Match when={Display()}>{(D) => <Dynamic component={D()} {...fields()} />}</Match>
      </Switch>
    </div>
  );
}

/** A list of blocks, walked — text through the schema's serializer, custom blocks through their display components. */
export function Blocks(props: { blocks: readonly ContentBlock[] }): JSX.Element {
  return (
    <For each={props.blocks}>
      {(block) => (
        <Switch
          fallback={
            <DraggableBlock block={block}>
              <CustomBlockElement block={block} />
            </DraggableBlock>
          }
        >
          <Match when={isTextBlock(block) ? block : null}>
            {(b) => (
              <DraggableBlock block={b()}>
                <TextBlockElement block={b()} />
              </DraggableBlock>
            )}
          </Match>
          <Match when={isCollectionBlock(block) ? block : null}>
            {(b) => (
              <CollectionDisplay
                layout={b().layout}
                columnCount={b().columnCount}
                gap={b().gap}
                content={b().content}
              />
            )}
          </Match>
        </Switch>
      )}
    </For>
  );
}

/**
 * Read-only rendering of a composition: a walker over the blocks, no editor. Accepts the
 * `data:…;base64,…` string a resolved file field reads as or already-decoded blocks, and resolves
 * stored file addresses against the host's dataset before drawing.
 *
 * ## A composition it cannot read says so
 *
 * `decodeEditorState` answers null for anything that is not a composition — the Lexical tree WE
 * stored before the content layer, a truncated blob, a future format. That null used to become
 * `[]`, which renders as an *empty post*: indistinguishable from one somebody wrote nothing in.
 * Opening the composer on it then made it worse, since the composer starts from the same nothing
 * and its save treats every still-linked block as somebody else's addition — so the author saw an
 * empty box, wrote something, and got a "changed by someone else" toast for their trouble.
 *
 * WE has no consumers on the old format and is not carrying a migration for one, so the answer is
 * not to read it — it is to stop pretending there was nothing there. The blocks themselves are
 * untouched either way; only the blob is unreadable.
 *
 * @superclass DesignSystemElement
 */
export function BlockRenderer(props: Props) {
  const host = useBlockHost();
  const { width = '100%', rootClass } = props;

  const [blocks] = createResource(
    () => ({ state: props.editorState, dataset: props.perspective ?? host.dataset() }),
    async ({ state, dataset }): Promise<ContentBlock[] | null> => {
      if (state === undefined || state === null) return [] as ContentBlock[];
      // Null, not `[]`. Empty and unreadable are different things and only one of them is true.
      const decoded = decodeEditorState(state);
      if (decoded === null) return null;
      if (!dataset) return decoded;
      try {
        return await resolveExpressionAddresses(dataset, decoded);
      } catch (error) {
        console.error('BlockRenderer: error resolving expression addresses', error);
        return decoded;
      }
    },
  );

  const themeRoot = rootClass
    ? `we-block-renderer we-block-content ${rootClass}`
    : 'we-block-renderer we-block-content';

  return (
    <Column class="we-block-renderer-wrapper" width={width} ax={props.ax} ay={props.ay}>
      {/*
        `data-we-text`: a press on these words selects them. A card that can be dragged around a
        composition used to pick the whole post up the moment somebody tried to highlight a sentence.
      */}
      <div class={themeRoot} data-we-text="">
        <BlockDragContext.Provider value={props.blockDrag?.within ? props.blockDrag : undefined}>
          <Switch fallback={<Blocks blocks={blocks() ?? []} />}>
            <Match when={blocks() === null}>
              <div class="we-unreadable-content">This was written in a format this version of WE cannot read.</div>
            </Match>
          </Switch>
        </BlockDragContext.Provider>
      </div>
    </Column>
  );
}
