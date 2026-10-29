/**
 * A group: one or more panels sharing a place — the unit every lane arranges.
 *
 * Alone, a panel is its group; several sharing a place are tabs, one showing — the one most recently
 * raised or opened — and the front one's titlebar (or flush header) naming them all. One component
 * wherever a group is: a seat of a template's lane, a seat of a window edge's lane. What differs
 * between those is only the box the place gives the group, which the place passes in.
 *
 * Each panel is drawn in its frame (`frameBox`) — the same frame a card floating over the window has,
 * so a panel looks and behaves the same in every place. The frame reads where it is from the geometry
 * (`home`, `inLane`) and how it is framed from `shellStore.panelFrames` — its own declaration, else its
 * lane's default. Its content is the panel host's, drawn once and moved in (`PanelHost`).
 *
 * ## Tabs behind the front stay mounted
 *
 * Every member keeps its frame and its content, hidden rather than unmounted while another is in
 * front: a call in a background tab keeps its streams, a transcript its scroll.
 */
import { dockRegistry, dockTitle, frameBox } from '@shared/registries/dockRegistry';
import { chromeBag } from '@shared/registries/templateBag';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import type { TemplatePanel } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { For, type JSX, onCleanup } from 'solid-js';
import { panelTrace } from '@shared/panelTrace';

/** What a panel is called: its declared title, else its dock's name. */
export function panelTitle(dockId: string, declared: TemplatePanel | undefined): string {
  if (declared?.title) return declared.title;
  const entry = dockRegistry.get(dockId);
  return entry ? dockTitle(entry) : dockId;
}

/** A panel's id as a lane's seams know it: a template's panel by its own id, anything else by its dock's. */
export const sectionKey = (dockId: string) => dockId.replace(/^template:/, '');

/** One panel's frame, drawn with the chrome's stores, as the shell draws a card over the window. */
export function PanelFrame(props: { id: string }) {
  panelTrace('frame mount (lane)', props.id);
  onCleanup(() => panelTrace('frame cleanup (lane)', props.id));
  const entry = dockRegistry.get(props.id);
  const bag = chromeBag();
  return entry && bag ? RenderSchema({ node: frameBox(entry), stores: bag, registry }) : null;
}

/**
 * A group's box and its members' frames. `style` is the box its place gives it; `attrs` whatever the
 * place measures it by (a template lane's sections, by `HOME_SECTION_ATTR`).
 */
export function PanelGroup(props: { members: string[]; style?: JSX.CSSProperties; attrs?: Record<string, string> }) {
  return (
    <div {...props.attrs} style={props.style}>
      <For each={props.members}>{(id) => <PanelFrame id={id} />}</For>
    </div>
  );
}

export default PanelGroup;
