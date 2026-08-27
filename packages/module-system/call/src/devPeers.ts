/**
 * Synthetic participants, for looking at the call stage without finding two other people.
 *
 * ## Why this is worth keeping
 *
 * The stage's layout is the part of this module with the most behaviour and the least reachable
 * test: the arrangement is solved against the panel's box, so seeing whether it is right means
 * dragging a real panel around with a real call running. One person cannot start a three-way call,
 * and a unit test cannot tell you that four tiles in a wide panel look wrong. This closes that gap
 * for the cost of one file.
 *
 * It fakes at the **tile** layer deliberately. The mesh, the media controller and presence are all
 * untouched, so nothing here can teach you anything about signalling or negotiation — it is a
 * layout harness, and pretending otherwise would make it a liability. What it does exercise is
 * everything downstream of "there are N participants": the tiling solve, the spotlight's choice of
 * axis, fit-to-content at each arrangement, the mute badge, and the avatar fallback.
 *
 * ## Turning it on
 *
 * A `+`/`−` pair appears in the call bar in a development build, showing the current count. That is
 * deliberately not a `localStorage` incantation to paste: the whole point of this is dragging the
 * panel and watching the arrangement re-solve, and going to a console to try five people instead of
 * three breaks exactly the loop it exists to support. It is also the difference between a harness
 * you can see is on and one you cannot — a count left set and forgotten is otherwise two phantom
 * participants in a real call a week later, with nothing on screen to explain them.
 *
 * `localStorage` is still where the count lives, so it survives the reloads you do while iterating.
 * The buttons write it; nobody has to type it.
 *
 * ## Why it cannot reach production
 *
 * Two gates, and the second is the one doing the work. `import.meta.env.DEV` is `false` in a
 * production build, which a bundler may or may not use to drop the code entirely depending on how
 * it substitutes; the guarantee is the `localStorage` count key, which nobody sets by accident and
 * which no build carries. Together: it is not in a shipped app's behaviour, and it is not in a
 * developer's either until they ask.
 *
 * ## Turning it off in a build that has it
 *
 * A third gate, and the only one that can be thrown deliberately: `devToolsEnabled` reads the shared
 * `we.devTools` switch, so a developer checking what a *user* sees loses these controls along with
 * every other developer affordance rather than having to remember this one separately. It is read
 * here at module scope, which is why it takes a reload — see the note there.
 */

import { devToolsEnabled } from '@we/module-shared';

const STORAGE_KEY = 'we.call.fakePeers';

/** More than this is a stray keypress rather than a test. */
const MAX = 24;

/**
 * Whether any of this exists at all.
 *
 * Read once, at module scope, so the module definition can decide whether to contribute its
 * controls to the call bar — a decision made when the module is defined, not per render, which is
 * what keeps the whole path out of a production bundle rather than merely inert in one.
 *
 * Cast rather than `vite/client` types: a feature module must not take a build tool as a
 * dependency, since one may be loaded into a host that uses none. The cast is erased at compile
 * time and the emitted `import.meta.env?.DEV` is what a bundler sees.
 */
export const devPeersAvailable = devToolsEnabled((import.meta as { env?: { DEV?: boolean } }).env?.DEV === true);

/** Identity and media for one synthetic participant. The store turns these into tiles. */
export interface DevPeer {
  id: string;
  stream: MediaStream | null;
  /** Alternated, so the mute badge is on screen at any count above one. */
  audioEnabled: boolean;
}

const streams = new Map<number, MediaStream>();
const timers: ReturnType<typeof setInterval>[] = [];

/** How many to add, or 0 — which is every production build, and every dev session but the ones asking. */
export function readDevPeerCount(): number {
  if (!devPeersAvailable || typeof localStorage === 'undefined') return 0;
  const raw = Number(localStorage.getItem(STORAGE_KEY));
  return clampCount(raw);
}

/** Remember the count across the reloads a developer does while iterating. */
export function writeDevPeerCount(count: number): number {
  const next = clampCount(count);
  if (!devPeersAvailable || typeof localStorage === 'undefined') return next;
  if (next === 0) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, String(next));
  return next;
}

function clampCount(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX) : 0;
}

/**
 * A canvas, painted a few times a second and captured as a stream.
 *
 * Real moving video rather than a still, because half of what this is for is noticing when a tile
 * has stopped updating — a remount that dropped its `srcObject` looks exactly like a working tile
 * until something in it moves. Hence the marker sliding along the bottom.
 *
 * 640×360, so the source is genuinely 16:9 and `cover` crops nothing. A tile that letterboxes is
 * then the layout's doing rather than the fixture's.
 */
function peerStream(index: number): MediaStream | null {
  const cached = streams.get(index);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const capture = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream;
  if (!ctx || typeof capture !== 'function') return null;

  const hue = (index * 67) % 360;
  let frame = 0;
  const draw = () => {
    frame += 1;
    ctx.fillStyle = `hsl(${hue} 40% ${16 + 5 * Math.sin(frame / 18)}%)`;
    ctx.fillRect(0, 0, 640, 360);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, 624, 344);
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 150px sans-serif';
    ctx.fillText(String(index + 2), 320, 170);
    ctx.font = '22px sans-serif';
    ctx.fillText('fake peer · 640×360', 320, 290);
    ctx.fillRect(20 + ((frame * 5) % 580), 328, 24, 8);
  };

  draw();
  timers.push(setInterval(draw, 1000 / 15));
  const stream = capture.call(canvas, 15);
  streams.set(index, stream);
  return stream;
}

/** The synthetic participants to append, stable across rebuilds so their video never remounts. */
export function devPeers(count: number): DevPeer[] {
  if (count <= 0) {
    // Turned off mid-session; stop painting rather than wait for the call to end.
    if (streams.size > 0) stopDevPeers();
    return [];
  }
  // Anything above the new count stops now — dropping from five to two should not leave three
  // canvases running for a call nobody can see them in.
  for (const [index, stream] of [...streams]) {
    if (index < count) continue;
    stream.getTracks().forEach((track) => track.stop());
    streams.delete(index);
  }
  return Array.from({ length: count }, (_, index) => ({
    id: `fake-peer-${index}`,
    stream: peerStream(index),
    audioEnabled: index % 2 === 0,
  }));
}

/** Stop the canvases. Called when the call ends, so a closed call leaves no timers running. */
export function stopDevPeers(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
  streams.clear();
}
