/**
 * What a drag looks like in WE: the host's answer to `@we/drag`'s ghost seam.
 *
 * ## Why the host draws it
 *
 * `@we/drag` knows about references, rectangles and the top layer, and deliberately nothing about
 * what a record *looks like* — it has no dependency on the design system and must keep none, since
 * the sortable and the block editor drive it from inside that system. So it asks: `setGhostRenderer`
 * takes a function, calls it when a `node` ghost is wanted, and falls back to its own chip when
 * there is no answer.
 *
 * This is the same arrangement the graph engine has for card content, where the host supplies a
 * component under the name `block` and the engine only decides where it goes. Second occurrence of
 * a shape, which is the point at which it is worth recognising as one.
 *
 * ## Why it renders a fragment rather than building DOM
 *
 * Because `recordCard` is data. Building the markup here would put "what a record looks like" into
 * compiled host code, where a community cannot fork it, a theme reaches it only through whatever
 * variables it happened to use, and the marketplace can never carry an alternative. Rendering it
 * through `RenderSchema` costs one Solid root per drag and keeps the whole appearance on the data
 * side of the line.
 *
 * ## Everything here is synchronous
 *
 * The ghost has to exist on the frame the gesture begins, so nothing below fetches: the picture, the
 * composed document and the author's DID all arrive on the payload, and the profile behind that DID
 * comes from a cache that is already populated for anyone whose card is on screen. A DID with no
 * cached profile draws an identicon, which is what an unresolved person looks like everywhere else.
 */
import type { DragItem } from '@we/drag';
import { setGhostRenderer } from '@we/drag';
import { recordCard } from '@we/schema-kit';
import type { SchemaNode } from '@we/schema-shared';
import type { RenderProps } from '@we/schema-solid';
import { RenderSchema } from '@we/schema-solid';
import { render } from 'solid-js/web';

/** The face and name behind a DID, as far as a ghost needs them. */
export interface GhostAgent {
  name: string;
  avatar: string;
}

export interface RecordGhostDeps {
  /** The bag `RenderSchema` resolves against. The chrome bag: this is host-authored. */
  stores: RenderProps['stores'];
  registry: RenderProps['registry'];
  /** Whoever a payload names as author, from whatever cache the host keeps. */
  agent: (did: string) => GhostAgent | undefined;
}

/** Where a Solid root's teardown is hung, for `createGhost`'s `destroy` to find. */
type Disposable = HTMLElement & { _weDispose?: () => void };

/**
 * Register WE's ghost. Returns the unregistration.
 *
 * Once, at start-up: there is one drag session per window, so there is one answer to what a record
 * looks like here.
 */
export function registerRecordGhost(deps: RecordGhostDeps): () => void {
  return setGhostRenderer((items) => {
    const [first] = items;
    if (!first) return null;

    const host = document.createElement('div') as Disposable;
    const node = ghostNode(first, items.length, deps);
    const dispose = render(() => RenderSchema({ node, stores: deps.stores, registry: deps.registry }), host);
    host._weDispose = dispose;
    return host;
  });
}

/** The tile, plus a count when a drag carries more than one thing. */
function ghostNode(item: DragItem, count: number, deps: RecordGhostDeps): SchemaNode {
  const card = cardFor(item, deps);
  if (count < 2) return card;

  return {
    type: 'Column',
    props: { position: 'relative' },
    children: [
      card,
      {
        /*
          A count rather than a fan of stacked tiles. A stack would have to guess an offset that
          works at every tile size and in every corner of the screen, and it says the same thing
          less legibly — the question somebody dragging four things has is "four?", not "which
          four?", which is answered by the panel they are dragging into.
        */
        type: 'Column',
        props: {
          position: 'absolute',
          top: '-6px',
          right: '-6px',
          bg: 'accent',
          color: 'on-accent',
          r: 'pill',
          px: '200',
          py: '100',
          ax: 'center',
          ay: 'center',
          shadow: 'sm',
        },
        children: [{ type: 'we-text', props: { variant: 'footnote', color: 'on-accent' }, children: [String(count)] }],
      },
    ],
  };
}

function cardFor(item: DragItem, deps: RecordGhostDeps): SchemaNode {
  const preview = item.preview ?? {};
  const author = preview.author ? deps.agent(preview.author) : undefined;

  return recordCard({
    ghost: true,
    label: item.label,
    icon: item.icon ?? 'file',
    ...(preview.thumbnail && { thumbnail: preview.thumbnail }),
    /*
      The composed document, drawn for real. This is what makes a post's own picture appear on the
      tile: there is no thumbnail field on `CollectionBlock`, and there does not need to be, because
      the row the drag started from was already rendering this exact string.
    */
    ...(preview.content && {
      content: { type: 'BlockRenderer', props: { editorState: preview.content } },
    }),
    ...(preview.date && { date: preview.date }),
    ...(preview.author && {
      byline: {
        // An identicon seeded by the DID where the profile has not arrived — never a blank disc,
        // which would make two unresolved people look like the same person.
        hash: preview.author,
        ...(author?.name && { name: author.name }),
        ...(author?.avatar && { avatar: author.avatar }),
      },
    }),
  });
}
