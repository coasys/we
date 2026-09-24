/**
 * The host half of the `view` kernel: what this agent's screen is, and what other people's marks are
 * drawn on.
 *
 * ## What is here and what is in `shared/liveView.ts`
 *
 * The arithmetic and the DOM reading are there, pure and testable — where a point is in a record's
 * box, which record is at the top of a scroll, what a frame is made of. What is here is the part that
 * needs the app: the router, the shell's insets, the schema renderer, and Solid's reactivity.
 *
 * ## A singleton, not a context
 *
 * The state is module-level, like `moduleHostServices`', because two very distant things read it — this
 * component and `GraphHost`, which is mounted by whatever route happens to draw a canvas — and a
 * context would mean every graph in the app being a descendant of this component, which is a
 * constraint on the shell's arrangement that nothing else imposes.
 *
 * ## Marks a canvas draws, and marks this draws
 *
 * A canvas is a world surface: it has a camera, and it draws its own marks inside the layer that
 * camera transforms, so they pan and zoom for free. `GraphHost` reads them through
 * {@link liveSurfaceMarks}.
 *
 * Everything else — a mark on a record, a mark at a fraction of the content box — has no camera to
 * ride, so this component positions it in screen pixels and repositions it when the page scrolls or
 * resizes. That is the whole of the overlay below.
 */
import {
  allMarks,
  anchorForPoint,
  canvasSurface,
  composeFrame,
  liveView as state,
  notifyLiveViewChanged,
  onLiveViewChanged,
  pointForAnchor,
  regionFor,
  reportPointer,
  requestRegion,
  routeSurface,
} from '@shared/liveView';
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { chromeBag } from '@shared/registries/templateBag';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import { useRouteStore } from '@solid/stores/RouteStore';
import { useShellStore } from '@solid/stores/ShellStore';
import type { LiveDecoration, ViewFrame, ViewKernel } from '@we/module-shared';
import { RenderSchema } from '@we/schema-solid';
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';

/**
 * Bumped whenever the set of registered things changes — a module calling `decorate`, a canvas mounting
 * or leaving.
 *
 * The marks themselves need no version: they come from accessors a module owns, so reading one inside a
 * Solid computation already tracks whatever signal it reads. What is *not* reactive on its own is the
 * `Set` those accessors live in, and the `Map` of surfaces, both of which are mutated in place.
 *
 * Subscribed to the registry rather than owned here, because a module registers before this component
 * exists — see `liveView` for why that is the ordinary case and not a race.
 */
const [registered, setRegistered] = createSignal(0);

/**
 * Bump it, from anywhere, safely.
 *
 * Two rules, and breaking either froze the whole app.
 *
 * **Never read while writing.** `setRegistered(registered() + 1)` reads inside whatever scope called it
 * — so a computation that also reads `registered` gained a dependency on a signal it had just written,
 * re-ran, wrote again, and recursed until the stack went. `markDownstream` all the way down, and the
 * only visible symptom was a frozen tab. The updater form reads nothing.
 *
 * **Never write synchronously into somebody else's computation.** A registration can arrive while a memo
 * is mid-flight — a canvas registering as the graph first reads its decorations — and a synchronous
 * write there invalidates that memo from inside itself. Deferred to a microtask it is an ordinary
 * update: the memo finishes, then re-runs once. Coalesced, so a burst of registrations costs one.
 */
let bumpQueued = false;
function bumpRegistered(): void {
  if (bumpQueued) return;
  bumpQueued = true;
  queueMicrotask(() => {
    bumpQueued = false;
    setRegistered((n) => n + 1);
  });
}

onLiveViewChanged(bumpRegistered);

/**
 * Bumped whenever a canvas reports a new camera, so a frame read picks it up.
 *
 * Separate from `registered` because it fires on every pan, where that one fires when something mounts.
 */
const [cameras, setCameras] = createSignal(0);

/** Marks addressed to one surface, for the surface to draw itself. */
export function liveSurfaceMarks(key: string): LiveDecoration[] {
  registered();
  return allMarks(state).filter((mark) => mark.at.surface === key && mark.at.kind === 'world');
}

/** The region a surface has been asked to frame, or `null`. See `regionFor` for why it expires. */
export function liveSurfaceRegion(key: string) {
  cameras();
  return regionFor(state, key);
}

/**
 * Register a canvas as a world surface for as long as it is on screen.
 *
 * Returns the reporters it needs: where its pointer is, and what its camera can see. Both are
 * forwarded rather than read, because only the canvas holds a camera and only this holds the
 * registry.
 */
export function registerLiveCanvas(canvasId: string) {
  const key = canvasSurface(canvasId);
  state.surfaces.set(key, { key });
  notifyLiveViewChanged();
  return {
    key,
    reportPointer: (at: { x: number; y: number } | null) =>
      reportPointer(state, key, at ? { surface: key, kind: 'world', x: at.x, y: at.y } : null),
    reportRegion: (region: { x: number; y: number; width: number; height: number }) => {
      const surface = state.surfaces.get(key);
      if (!surface) return;
      surface.region = region;
      // Updater form, for the reason `bumpRegistered` gives: a read here would make whatever scope is
      // running depend on a signal it just wrote.
      setCameras((n) => n + 1);
    },
    dispose: () => {
      state.surfaces.delete(key);
      state.pointerBySource.delete(key);
      state.requested.delete(key);
      notifyLiveViewChanged();
    },
  };
}

/**
 * Binds the `view` kernel and draws the marks a canvas cannot.
 *
 * Mounted once, beside the app's other always-on chrome.
 */
export function LiveViewHost() {
  const routeStore = useRouteStore();
  const shellStore = useShellStore();

  /**
   * The box a template's own content occupies — the window, less what displacing panels have taken.
   *
   * `contentInset` rather than `coveredInset`: a floating panel takes no room, so the content box is
   * unchanged and a fraction of it still means the same place on both screens. What is behind the
   * float is still content, and a peer pointing at it is pointing at something real.
   */
  const content = () => {
    const inset = shellStore.contentInset();
    const width = window.innerWidth - inset.left - inset.right;
    const height = window.innerHeight - inset.top - inset.bottom;
    return { x: inset.left, y: inset.top, width: Math.max(0, width), height: Math.max(0, height) };
  };

  /** The whole address, query included — see `ViewFrame.path` for why the query is not optional. */
  const address = () => {
    const path = routeStore.currentPath();
    const params = new URLSearchParams(routeStore.params() as Record<string, string>).toString();
    return params ? `${path}?${params}` : path;
  };

  /*
    This agent's pointer, wherever it is that is not a canvas.

    On the document in the capture phase, so it is seen whatever else handles it and whatever stops
    propagation on the way up. Passive: it never calls `preventDefault`, and saying so lets the browser
    keep scrolling while this runs.

    Coalesced to one report per frame, exactly as the graph's own is, and for the same reason.
  */
  onMount(() => {
    let frame: number | null = null;
    let latest: { point: { x: number; y: number }; target: Element | null } | null = null;

    const flush = () => {
      frame = null;
      if (!latest) return;
      const anchor = anchorForPoint(routeSurface(routeStore.currentPath()), latest.point, latest.target, content());
      reportPointer(state, 'document', anchor);
    };

    const onMove = (event: PointerEvent) => {
      latest = { point: { x: event.clientX, y: event.clientY }, target: event.target as Element | null };
      if (frame === null) frame = requestAnimationFrame(flush);
    };

    /*
      The pointer left the window, so there is nothing to say about it.

      `pointerout` with no `relatedTarget` is the one that means "left the document" rather than
      "moved between two elements", which fires constantly and would blink every peer's cursor.
    */
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      latest = null;
      reportPointer(state, 'document', null);
    };

    document.addEventListener('pointermove', onMove, { capture: true, passive: true });
    document.addEventListener('pointerout', onOut, { capture: true, passive: true });
    onCleanup(() => {
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', onMove, { capture: true });
      document.removeEventListener('pointerout', onOut, { capture: true });
    });
  });

  /**
   * Bumped by anything that moves the page without changing what is on it — a scroll, a resize.
   *
   * Two readers, and both need it. A mark anchored to a record has moved on screen without the mark
   * changing, so the overlay has to re-place it. And `frame()` below describes a scrolling surface by
   * *which record is at the top*, which is a different answer after a scroll — without this a driver
   * scrolling a board would publish nothing until the two-second repeat came round, so a follower
   * would trail a page behind them.
   *
   * Listened for in the **capture** phase on the document, because `scroll` does not bubble: a scroll
   * inside a panel or a board column would otherwise never be seen at all.
   */
  const [geometry, setGeometry] = createSignal(0);
  onMount(() => {
    const invalidate = () => setGeometry(geometry() + 1);
    document.addEventListener('scroll', invalidate, { capture: true, passive: true });
    window.addEventListener('resize', invalidate, { passive: true });
    onCleanup(() => {
      document.removeEventListener('scroll', invalidate, { capture: true });
      window.removeEventListener('resize', invalidate);
    });
  });

  /*
    Only `frame` and `apply`, because only those need the app.

    `decorate` and `onPointer` are registrations a module makes when its store is built, which happens
    before this component exists — so they live in the shared registry and are wired straight to it in
    `moduleHostServices`. Publishing them here as well would be two paths to one set, and the one that
    lost would be the one a module actually used.
  */
  const kernel: Pick<ViewKernel, 'frame' | 'apply'> = {
    frame: () => {
      // Both: a camera move changes the region, and a scroll changes which record is at the top.
      cameras();
      geometry();
      return composeFrame(state, { path: address(), pathname: routeStore.currentPath() }, content());
    },
    apply: (frame) => applyFrame(frame),
  };

  /**
   * Show this agent what somebody else is looking at.
   *
   * Address first, then the surface, and the order is what makes it work across a route change: the
   * canvas being framed may not be mounted yet, so the region is *held* — see `requestRegion` — and
   * picked up by whichever surface appears. It expires, so a stale one cannot drag somebody somewhere
   * a minute later.
   *
   * A scroll anchor is applied directly, because the element either exists now or the frame was about
   * a page this agent is not on, in which case the navigation above has just started and the next
   * frame the driver publishes will land.
   */
  function applyFrame(frame: ViewFrame) {
    if (frame.path && frame.path !== address()) routeStore.navigate(frame.path);
    if (frame.surface && frame.region) requestRegion(state, frame.surface, frame.region);
    if (frame.anchor) scrollToAnchor(frame.anchor);
  }

  /**
   * Put the record the driver had at the top of their view at the top of this one.
   *
   * The anchor's `offset` is a fraction of the record's own height, so it is resolved by asking where
   * that fraction of that box currently is and scrolling by the difference — which needs no knowledge
   * of how tall the record is here, and works in a nested scroll container as well as on the page.
   */
  function scrollToAnchor(anchor: { record: string; offset: number }) {
    const box = content();
    const at = pointForAnchor({ surface: '', kind: 'record', record: anchor.record, x: 0, y: anchor.offset }, box);
    if (!at) return;
    window.scrollBy({ top: at.y - box.y, behavior: 'auto' });
  }

  // Merged with the registry half in `moduleHostServices`, which owns the kernel a module sees.
  onCleanup(provideModuleHostServices({ view: kernel as ViewKernel }));

  // ── The overlay ────────────────────────────────────────────────────────────

  /**
   * The marks this component draws: everything not addressed to a canvas, resolved to a client point.
   *
   * A mark whose frame is not on this screen resolves to nothing and is dropped, which is the ordinary
   * case for a peer looking at another route. Recomputed when the marks change, when the page moves,
   * and when the address changes.
   */
  const placed = createMemo(() => {
    registered();
    geometry();
    const here = routeSurface(routeStore.currentPath());
    const box = content();
    const out: { mark: LiveDecoration; at: { x: number; y: number } }[] = [];
    for (const mark of allMarks(state)) {
      if (mark.at.kind === 'world') continue;
      if (mark.at.surface !== here) continue;
      const at = pointForAnchor(mark.at, box);
      if (at) out.push({ mark, at });
    }
    return out;
  });

  /** The store bag chrome renders against. Null for the frames before boot finishes. */
  const bag = () => chromeBag();

  return (
    <Show when={bag() && placed().length > 0}>
      {/*
        One fixed, click-through layer for every mark.

        `position: fixed` because the points are client coordinates — which is what `getBoundingClientRect`
        gives and what stays correct through a nested scroll container, where an absolutely positioned
        layer would need to know which one it was inside.
      */}
      <div
        style={{
          position: 'fixed',
          inset: '0',
          'pointer-events': 'none',
          // Above the content and below the app's own chrome. A peer's mark must not paint over a
          // panel's titlebar or a modal: a cursor obscuring a control is worse than one clipped.
          'z-index': 'var(--we-z-index-sticky)',
        }}
      >
        {/*
          Keyed by id, which is why this iterates ids rather than the entries.

          `<For>` keys by reference and the memo above rebuilds its objects on every scroll — so
          iterating entries would recreate every mark, and a recreated element has no previous
          transform to transition from. Exactly the trap the canvas layer has, and the same fix: two
          equal strings are the same value.
        */}
        <For each={placed().map((entry) => entry.mark.id)}>
          {(id) => {
            const entry = () => placed().find((candidate) => candidate.mark.id === id);
            // Drawn once while this id is present — see `LiveDecoration.node`. Anything inside it that
            // can change is a reactive read within the rendered tree.
            const drawn = RenderSchema({ node: entry()!.mark.node, stores: bag()!, registry });
            return (
              <div
                style={{
                  position: 'absolute',
                  left: '0',
                  top: '0',
                  transform: `translate(${entry()?.at.x ?? 0}px, ${entry()?.at.y ?? 0}px)`,
                  // The same 90ms linear catch-up the canvas uses, for the same reason — see
                  // `.we-graph__decoration--eased`. A record-anchored mark is not eased: it is where
                  // its card is, and easing it would animate a pin across the screen when a board
                  // reorders.
                  ...(entry()?.mark.ease ? { transition: 'transform 90ms linear' } : {}),
                }}
              >
                {drawn}
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
