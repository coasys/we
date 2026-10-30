/**
 * What each panel draws, by panel id — the content a frame on an edge, a section in a lane, or any
 * other place shows, registered once by whoever builds the panel's place (`dockFrame`).
 *
 * Kept apart from the places themselves because a panel is drawn **once**, by the panel host, and
 * moved between places — see `PanelHost`. A place only names the panel it is showing; the content
 * lives here, so moving a panel from an edge into a lane, or out to float, never builds it again.
 */
import type { SchemaNode } from '@we/schema-shared';

const contents = new Map<string, SchemaNode>();
const listeners = new Set<(id: string) => void>();

/** Say what a panel draws. Registering the same node again is not a change. */
export function registerPanelContent(id: string, node: SchemaNode): void {
  if (contents.get(id) === node) return;
  contents.set(id, node);
  for (const listener of listeners) listener(id);
}

/** What a panel draws, or undefined for one nothing has registered. */
export function panelContent(id: string): SchemaNode | undefined {
  return contents.get(id);
}

/** Hear when a panel's content is registered or replaced. Returns the unsubscribe. */
export function onPanelContentChanged(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
