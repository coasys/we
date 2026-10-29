/**
 * Every panel drawn once, and moved to wherever it is.
 *
 * A panel is placed in one of several kinds of place — a frame on an edge or floating, a section in a
 * template's lane — and is moved between them by a drag. Drawn by the place, a move built it again:
 * an embedded page reloaded, focus was lost, a globe's WebGL context went, and a recount of where
 * everything is (every frame of a drag) could rebuild a panel that had not moved at all.
 *
 * So places do not draw panels. A place holds a {@link PanelSlot} naming the panel it shows; the
 * host draws the panel's content once, inside its own reactive owner — the app's providers, beside
 * the chrome — into a wrapper element, and the slot takes the wrapper. A move is the wrapper being
 * put into a new slot, with `moveBefore` where the browser has it, which keeps an iframe's page, focus,
 * a WebGL context and running animations; elsewhere `appendChild`, which loses those only at the
 * moment of a drop into a different kind of place, never during a drag.
 *
 * A panel no slot holds waits in the host's parking element, still in the page, and is disposed a
 * moment later unless a slot takes it back — which a move between two places does at once. Closing a
 * panel unmounts its slot, so a closed call stops decoding video as it always did.
 */
import { dockRegistry, onDockRegistryChanged } from '@shared/registries/dockRegistry';
import { resolveParts } from '@shared/registries/moduleParts';
import { onPanelContentChanged, panelContent } from '@shared/registries/panelContents';
import { slotRegistry } from '@shared/registries/slotRegistry';
import { chromeBag } from '@shared/registries/templateBag';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import {
  createMemo,
  createRoot,
  createSignal,
  ErrorBoundary,
  getOwner,
  onCleanup,
  onMount,
  type Owner,
  runWithOwner,
} from 'solid-js';
import { insert } from 'solid-js/web';

import TemplatePanelBody from './TemplatePanelBody';

/** One panel's drawn content: the wrapper it lives in, and how to take it down. */
interface Drawn {
  wrapper: HTMLElement;
  dispose: () => void;
  /** The slot holding it now, or null while it waits to be taken back or disposed. */
  holder: HTMLElement | null;
  /** The pending disposal, while nobody holds it. */
  release?: ReturnType<typeof setTimeout>;
}

const drawn = new Map<string, Drawn>();
let hostOwner: Owner | null = null;
let parking: HTMLElement | null = null;

/** How long a panel nobody holds waits for a place to take it back before it is disposed. */
const RELEASE_MS = 0;

/**
 * Put `node` last in `parent`, as a move rather than a remove and re-insert where the browser can —
 * see the module comment for what that keeps.
 */
export function placeNode(parent: HTMLElement, node: HTMLElement): void {
  const move = (parent as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }).moveBefore;
  if (
    typeof move === 'function' &&
    parent.isConnected &&
    node.isConnected &&
    parent.ownerDocument === node.ownerDocument
  ) {
    try {
      move.call(parent, node, null);
      return;
    } catch {
      // A move the browser refuses (a node from another document) falls back to the plain one.
    }
  }
  parent.appendChild(node);
}

/**
 * A module's or the host's panel, composed as the host composes chrome — the `$slot`s modules leave
 * for each other filled in, then its parts expanded. A template's own panel arrives as a
 * `TemplatePanelBody`, which does the same with the template's bag.
 */
function composed(node: SchemaNode): SchemaNode {
  const withSlots = slotRegistry.resolve(node);
  const expanded = (Array.isArray(withSlots) ? withSlots : [withSlots]).flatMap((part) => {
    const out = resolveParts(part);
    return Array.isArray(out) ? out : [out];
  });
  return expanded.length === 1
    ? expanded[0]
    : { type: 'Column', props: { styles: { display: 'contents' } }, children: expanded };
}

/** Draw a panel's content into a new wrapper, under `owner`. */
function draw(id: string, owner: Owner | null): Drawn {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'contents';
  wrapper.setAttribute('data-we-panel', id);
  const dispose = runWithOwner(owner, () =>
    createRoot((dispose) => {
      // Followed, so a template re-declaring its panel redraws inside the same wrapper, in place.
      const [version, setVersion] = createSignal(0);
      onCleanup(onPanelContentChanged((changed) => changed === id && setVersion((v) => v + 1)));
      // And a dock registered again with a node of its own, for one no frame registered content for —
      // only when *its* node changed: every registration announces, and redrawing every panel on every
      // one would rebuild a call's stage whenever a template declared a panel.
      let ownNode = dockRegistry.get(id)?.node;
      onCleanup(
        onDockRegistryChanged(() => {
          const node = dockRegistry.get(id)?.node;
          if (node === ownNode) return;
          ownNode = node;
          setVersion((v) => v + 1);
        }),
      );
      const body = createMemo(() => {
        version();
        // Registered by the place that built the panel's frame; a dock registered without one draws its own node.
        const node = panelContent(id) ?? dockRegistry.get(id)?.node;
        if (!node) return null;
        // A template's own panel, drawn with the template's bag — directly, not through the registry's lazy copy.
        if (node.type === 'TemplatePanelBody') {
          const { panelId, moduleId, dock, instance } = (node.props ?? {}) as {
            panelId?: string;
            moduleId?: string;
            dock?: string;
            instance?: string;
          };
          return <TemplatePanelBody panelId={panelId} moduleId={moduleId} dock={dock} instance={instance} />;
        }
        const bag = chromeBag();
        return bag ? RenderSchema({ node: composed(node), stores: bag, registry }) : null;
      });
      /*
        A panel that cannot be drawn says so in its own place rather than taking the app with it:
        anything can be moved anywhere, and a place cannot know everything will be at home there.
      */
      insert(wrapper, () => (
        <ErrorBoundary
          fallback={(error) => {
            console.error(`[PanelHost] ${id} could not be drawn`, error);
            return <we-text variant="footnote">This panel can't be shown here.</we-text>;
          }}
        >
          {body()}
        </ErrorBoundary>
      ));
      return dispose;
    }),
  )!;
  return { wrapper, dispose, holder: null };
}

/** Hand `slot` the panel's wrapper, drawing the panel if nothing has yet. */
function adopt(id: string, slot: HTMLElement, fallbackOwner: Owner | null): void {
  let entry = drawn.get(id);
  if (entry?.release) {
    clearTimeout(entry.release);
    entry.release = undefined;
  }
  if (!entry) {
    entry = draw(id, hostOwner ?? fallbackOwner);
    drawn.set(id, entry);
  }
  entry.holder = slot;
  placeNode(slot, entry.wrapper);
}

/** `slot` is going: park the panel, and dispose it unless another slot takes it back. */
function release(id: string, slot: HTMLElement): void {
  const entry = drawn.get(id);
  if (!entry || entry.holder !== slot) return;
  entry.holder = null;
  if (parking?.isConnected) placeNode(parking, entry.wrapper);
  entry.release = setTimeout(() => {
    if (entry.holder) return;
    drawn.delete(id);
    entry.dispose();
    entry.wrapper.remove();
  }, RELEASE_MS);
}

/**
 * Where a place shows a panel. Box-less (`display: contents`), so the panel lays out exactly as if
 * it were the place's own child — which it used to be.
 */
export function PanelSlot(props: { id: string }) {
  let slot!: HTMLDivElement;
  const owner = getOwner();
  onMount(() => adopt(props.id, slot, owner));
  onCleanup(() => release(props.id, slot));
  return <div ref={slot} style={{ display: 'contents' }} data-we-panel-slot={props.id} />;
}

/**
 * The host: the owner every panel is drawn under, and the parking element panels wait in between
 * places. Mounted once, beside the app's chrome, inside every provider a panel's content needs.
 */
export function PanelHost() {
  const owner = getOwner();
  hostOwner = owner;
  // Everything drawn under this host goes with it — content drawn under an owner that is gone would
  // be handed to the next place that asks, holding stores nothing provides any more.
  onCleanup(() => {
    if (hostOwner !== owner) return;
    hostOwner = null;
    for (const [id, entry] of drawn) {
      if (entry.release) clearTimeout(entry.release);
      entry.dispose();
      entry.wrapper.remove();
      drawn.delete(id);
    }
  });
  return (
    <div
      ref={(el) => {
        parking = el;
        onCleanup(() => {
          if (parking === el) parking = null;
        });
      }}
      hidden
      aria-hidden="true"
      data-we-panel-parking=""
    />
  );
}

export default PanelSlot;
