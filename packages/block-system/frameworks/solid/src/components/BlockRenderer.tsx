import type { BlockRendererProps, ContentBlock, TextContentBlock } from '@we/block-shared';
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
import { createMemo, createResource, For, Match, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import { registerCoreBlockComponents } from '../core-block-components';
import { blockToNode } from '../editor/converter';
import { getBlockSchema } from './BlockComposer';
import { useDisplayOverride } from './BlockDisplayOverrides';
import { useBlockHost } from './BlockHost';
import { CollectionDisplay } from './CollectionBlock/CollectionDisplay';

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

function CustomBlockElement(props: { block: ContentBlock }): JSX.Element {
  const Override = useDisplayOverride(props.block._type);
  const Display = () =>
    Override ??
    (getBlockRegistration(props.block._type)?.display as ((p: Record<string, unknown>) => JSX.Element) | undefined);
  const fields = () => {
    const { _type: _t, _key: _k, ...rest } = props.block;
    return rest;
  };
  return (
    <div class="we-block" data-block-type={props.block._type}>
      <Switch fallback={<div class="we-unknown-block">Unsupported block: {props.block._type}</div>}>
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
        <Switch fallback={<CustomBlockElement block={block} />}>
          <Match when={isTextBlock(block) ? block : null}>{(b) => <TextBlockElement block={b()} />}</Match>
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
 * `data:…;base64,…` string a resolved file field reads as, already-decoded blocks, or a legacy
 * tree, and resolves stored file addresses against the host's dataset before drawing.
 *
 * @superclass DesignSystemElement
 */
export function BlockRenderer(props: Props) {
  const host = useBlockHost();
  const { width = '100%', rootClass } = props;

  const [blocks] = createResource(
    () => ({ state: props.editorState, dataset: props.perspective ?? host.dataset() }),
    async ({ state, dataset }) => {
      if (state === undefined || state === null) return [] as ContentBlock[];
      const decoded = decodeEditorState(state) ?? [];
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
      <div class={themeRoot}>
        <Blocks blocks={blocks() ?? []} />
      </div>
    </Column>
  );
}
