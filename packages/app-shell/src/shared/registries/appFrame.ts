/**
 * The bands the app's own chrome holds, as the app template declares them — see `AppFrame`.
 *
 * A signal, so everything sized against the chrome follows when the app template changes: the shell's
 * geometry (its `viewport` reads this), the content viewport's offsets, and the CSS variables that
 * chrome outside the shell's arithmetic reads (`--we-sidebar-width`, `--we-chrome-rail-width`).
 */
import { type AppFrame, DEFAULT_APP_FRAME, setGeometryFrame } from '@shared/dockGeometry';
import type { PanelFrame, TemplateMeta } from '@we/schema-shared';
import { createSignal } from 'solid-js';

const [frame, setFrame] = createSignal<AppFrame>(DEFAULT_APP_FRAME);

/** The frame now in force. */
export const appFrame = frame;

/**
 * Take a frame from an app template's `meta.frame`. A declared frame names every band it holds; a
 * band it leaves out is empty. An app template that declares none keeps the built-in furniture.
 */
export function declareAppFrame(declared: Partial<AppFrame> | undefined): void {
  const next = declared
    ? { left: declared.left ?? 0, right: declared.right ?? 0, top: declared.top ?? 0, bottom: declared.bottom ?? 0 }
    : DEFAULT_APP_FRAME;
  const now = frame();
  if (now.left === next.left && now.right === next.right && now.top === next.top && now.bottom === next.bottom) return;
  setGeometryFrame(next);
  setFrame(next);
}

const [edgeFrames, setEdgeFrames] = createSignal<Partial<Record<'left' | 'right' | 'top' | 'bottom', PanelFrame>>>({});

/** How a panel pushing the content aside at each edge is framed by default, as the app declares it. */
export const appEdgeFrames = edgeFrames;

/** Take the edges' default frames from an app template's `meta.edges`. */
export function declareAppEdges(declared: TemplateMeta['edges']): void {
  const next: Partial<Record<'left' | 'right' | 'top' | 'bottom', PanelFrame>> = {};
  for (const [edge, setting] of Object.entries(declared ?? {}))
    if (setting?.frame) next[edge as keyof typeof next] = setting.frame;
  const now = edgeFrames();
  const same = Object.keys({ ...now, ...next }).every(
    (edge) => now[edge as keyof typeof now] === next[edge as keyof typeof next],
  );
  if (!same) setEdgeFrames(next);
}
