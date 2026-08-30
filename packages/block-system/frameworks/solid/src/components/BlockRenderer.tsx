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
      <div class={themeRoot}>
        <Switch fallback={<Blocks blocks={blocks() ?? []} />}>
          <Match when={blocks() === null}>
            <div class="we-unreadable-content">This was written in a format this version of WE cannot read.</div>
          </Match>
        </Switch>
      </div>
    </Column>
  );
}
