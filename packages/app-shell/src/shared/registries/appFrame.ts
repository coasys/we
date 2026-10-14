/**
 * The bands the app's own chrome holds, as the app template declares them — see `AppFrame`.
 *
 * A signal, so everything sized against the chrome follows when the app template changes: the shell's
 * geometry (its `viewport` reads this), the content viewport's offsets, and the CSS variables that
 * chrome outside the shell's arithmetic reads (`--we-sidebar-width`, `--we-chrome-rail-width`).
 */
import { type AppFrame, DEFAULT_APP_FRAME, setGeometryFrame } from '@shared/dockGeometry';
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
