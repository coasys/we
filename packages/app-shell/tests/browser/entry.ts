/**
 * The page side of the browser harness.
 *
 * Everything the app uses to draw a schema, in a real browser: the Solid renderer, the component
 * registry, the Lit primitives (upgraded, with their own shadow CSS), the design system's generated
 * interop stylesheet, and a seeded in-memory backend answering queries through the real IR.
 *
 * What is NOT here is the executor and the app's chrome. Data comes from a scenario's tables, and
 * the width comes from the caller rather than from a dock — which is the point rather than a
 * shortcoming: a layout bug is a function of width, and a harness that can sweep it finds the
 * breakpoint that manual resizing only approximates.
 *
 * Exposes `window.__harness` for the runner to drive.
 */
import '@we/primitives';

import { hostSourceBag } from '@shared/sources';
import { injectDSInteropStyles } from '@solid/dsInterop';
import { componentRegistry } from '@solid/registries/componentRegistry';
import { createInMemoryBackend } from '@we/backend-inmemory';
import { RenderSchema } from '@we/schema-solid';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';

import { installLayoutCounter, profile } from './instrument';
import { type Scenario, scenarios } from './scenarios';

installLayoutCounter();

/** Set by `mount`, so an interaction can make a profile arrive the way the network does. */
let arriveProfile: ((profile: { did: string } & Record<string, unknown>) => void) | undefined;

/** Store members every schema reads, whatever it is. A scenario overrides what it cares about. */
function defaultStores(): Record<string, unknown> {
  return {
    $me: { did: 'did:me' },
    $sources: hostSourceBag(),
    spaceStore: { mutedDids: [], currentSpace: { id: 'space-1' }, members: [] },
    profileStore: { profiles: [] },
    routeStore: { params: {}, currentPath: '/', segments: [], templateSegments: [] },
    recordStore: { displays: {} },
  };
}

let disposeMount: (() => void) | undefined;
/**
 * The backend the mounted scenario is reading, kept so an interaction can write to it.
 *
 * A perf case's subject is usually not the first paint but what one more row costs — and the honest
 * way to ask that is to put a row in the same way the app does, through the backend, so the whole
 * path runs: the subscription fires, the query re-answers, the renderer reconciles and the browser
 * lays out. A case that poked the DOM directly would be measuring itself.
 */
let mountedBackend: ReturnType<typeof createInMemoryBackend> | undefined;

function mount(name: string, width: number, scale?: number): void {
  disposeMount?.();
  const make = scenarios[name];
  if (!make) throw new Error(`unknown scenario "${name}" — have: ${Object.keys(scenarios).join(', ')}`);
  // A scenario that takes a scale seeds that many rows; one that does not ignores it, so every
  // existing layout case is untouched by the axis being there.
  const scenario: Scenario = make(scale);

  const backend = createInMemoryBackend({
    id: 'space-1',
    tables: scenario.tables as never,
    relations: scenario.relations,
  });
  mountedBackend = backend;

  const host = document.getElementById('mount') as HTMLElement;
  host.innerHTML = '';
  // The panel the schema believes it is in. Everything about a crowded row is downstream of this.
  host.style.width = `${width}px`;

  const stores: Record<string, unknown> = { ...defaultStores(), ...backend.stores, ...(scenario.stores ?? {}) };
  /*
    `$agent` resolves a DID through this port, not through `profileStore` — so a byline renders
    nothing at all without it, which is what the first run of this harness reported. The app's own
    port is a reactive cache over a network fetch; here every profile the scenario declares is
    already present, so `get` answers and `fetch` has nothing to do.
  */
  /*
    Reactive, and keyed, because the app's is both and the difference is measurable.

    A static array cannot show what a profile ARRIVING costs — which is the whole shape of a live
    call, where peers resolve one at a time while rows are already on screen. And keying it is what
    lets a row depend on its own agent rather than on the cache: a `find` over one array makes every
    `$agent` in the tree a reader of every profile, so one peer landing wakes all of them. Modelling
    the port as an array here would hide exactly the cost a perf case is looking for.
  */
  const seeded = (stores.profileStore as { profiles?: { did: string }[] } | undefined)?.profiles ?? [];
  const [identityOf, setIdentity] = createStore<Record<string, unknown>>(
    Object.fromEntries(seeded.map((p) => [p.did, p])),
  );
  arriveProfile = (profile: { did: string } & Record<string, unknown>) => setIdentity(profile.did, profile);
  stores.$identities = {
    get: (did: string) => identityOf[did],
    fetch: () => {},
  };
  disposeMount = render(
    () => RenderSchema({ node: scenario.node, stores, registry: componentRegistry } as never) as never,
    host,
  );
}

/** The box a schema node drew, and the handful of computed values a layout assertion reads. */
function box(el: Element) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
    display: cs.display,
    whiteSpace: cs.whiteSpace,
    overflowWrap: cs.overflowWrap,
    opacity: cs.opacity,
    // Type size decides where a line breaks and how tall a row is, and both of the DS's size props
    // reach an element through a custom property — so "did the size arrive" is a measurement.
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    // Resolved, so a case can compare two states of the same element without knowing the theme's
    // ramp direction — which is the only way to assert "more present" rather than "lighter".
    color: cs.color,
    // A mark drawn as a filled box — a rule, a bar, a swatch — carries its colour here rather than
    // in `color`, and a case that reads only the foreground sees nothing change.
    background: cs.backgroundColor,
    /*
      What the content wants, against what the box gives it.
      
      The difference is the only way to see text that does not fit. A box constrained by a width or
      a `max-width` measures the same whether its content wrapped into it or ran straight out of it,
      so a case comparing boxes cannot tell a laid-out line from an overflowing one — which is how
      an assertion about wrapping passed against the very `nowrap` it was written to catch.
    */
    scrollW: el.scrollWidth,
    scrollH: el.scrollHeight,
    // Where the scroller is, which is the only way to ask a question about scroll position at all —
    // and the thing a case needs to tell "at the bottom" from "somewhere that happens to look like
    // it". Under `flex-direction: column-reverse` it is also how a case checks that the ordinary
    // top-is-zero semantics still hold.
    scrollTop: Math.round(el.scrollTop),
    // Both spellings: a native control carries the attribute, a layout element carries the ARIA
    // one, and `disabledProps` keys off the second.
    disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
    text: (el.textContent ?? '').trim().slice(0, 80),
  };
}

/** The first element matching, or null. */
function measure(selector: string) {
  const el = document.querySelector(selector);
  return el ? box(el) : null;
}

/**
 * The box a primitive actually paints — `[part='base']` inside its shadow root.
 *
 * Most design-system props do not land on the host. `color`, `opacity`, `bg`, the borders and the
 * radii are all declared on `[part='base']`, so `getComputedStyle` on a `we-button` reports the
 * defaults for every one of them and a case reading the host concludes that nothing is applied.
 * That is not a detail of one component: it is how every `DesignSystemElement` is built, so a
 * harness that cannot see through a shadow root cannot check a visual prop at all.
 *
 * `part` names which box — most primitives draw into `base`, an overlay into its own. `nth` picks
 * among several of the same element, since a case comparing two of a thing is a common question.
 */
function measurePart(selector: string, part = 'base', nth = 0) {
  const host = document.querySelectorAll(selector)[nth];
  const el = host?.shadowRoot?.querySelector(`[part='${part}']`);
  return el ? box(el) : null;
}

/** Every element matching, so a case can assert about a row of siblings. */
function measureAll(selector: string) {
  return [...document.querySelectorAll(selector)].map(box);
}

/**
 * The element carrying exactly this text.
 *
 * An assertion about a person's name should not be spelled as a selector for the props the fix
 * happened to add — `we-text[truncate]` finds nothing on a tree where the name is not truncated, so
 * the regression it exists to catch reports as "nothing rendered". What the reader sees is a word,
 * so that is what the case names.
 */
function measureText(text: string, selector = '*') {
  const hits = [...document.querySelectorAll(selector)].filter((el) => (el.textContent ?? '').trim() === text);
  // The innermost one: a wrapper's text is its child's, and the child is the box that was laid out.
  const el = hits.findLast((candidate) => !hits.some((other) => other !== candidate && candidate.contains(other)));
  return el ? box(el) : null;
}

/**
 * The box of a control named by its accessible label.
 *
 * An icon-only button has no text to find it by, and `we-button` does not reflect `label` to an
 * attribute — it puts `aria-label` on the inner `<button>`, inside the shadow root, where
 * `querySelectorAll` cannot reach. So this looks through each host's shadow root and answers with
 * the HOST's box, which is the one the row laid out.
 *
 * Named after what a screen reader would call it, which is the right way to address a control that
 * has deliberately been left wordless.
 */
function measureControl(label: string, selector = 'we-button') {
  for (const host of document.querySelectorAll(selector)) {
    if (host.shadowRoot?.querySelector(`[aria-label="${label}"]`)) return box(host);
  }
  return null;
}

/**
 * An element and every box above it, outermost last.
 *
 * "The name wrapped" is never the whole story — something above it decided how much room it had,
 * and reading the chain is how that is found without scrolling through a page of markup.
 */
function chain(text: string) {
  const hit = document.evaluate(`//*[normalize-space(text())=${JSON.stringify(text)}]`, document, null, 9, null)
    .singleNodeValue as Element | null;
  /** What a `display: contents` wrapper resolves to: the boxes that actually lay out. */
  const laidOut = (el: Element): Element[] =>
    [...el.children].flatMap((kid) => (getComputedStyle(kid).display === 'contents' ? laidOut(kid) : [kid]));

  const out: (ReturnType<typeof box> & { tag: string; kids: string[] })[] = [];
  for (let el = hit; el && el.id !== 'mount'; el = el.parentElement) {
    if (getComputedStyle(el).display === 'contents') continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      ...box(el),
      // A box's siblings are usually the answer: an item is narrow because something beside it is
      // wide, and the schema's `display: contents` wrappers hide which items those actually are.
      kids: laidOut(el).map((k) => `${k.tagName.toLowerCase()} ${Math.round(k.getBoundingClientRect().width)}w`),
    });
  }
  return out;
}

/**
 * What holds the cursor, as a tag and a class — piercing shadow roots on the way down.
 *
 * `document.activeElement` stops at the host of whatever component has focus, so a composer inside
 * one reads as the component rather than as its editor. A case asking "did anything take the
 * cursor" needs the innermost answer.
 */
function focused(): string {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body) return '';
  return `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}`;
}

/** What the page is painted on, for a case asking whether a colour stands out from it. */
function pageColor(): string {
  return getComputedStyle(document.body).backgroundColor;
}

/** The mounted tree as markup — what a failing assertion is looked at through. */
function html(): string {
  return document.getElementById('mount')?.innerHTML ?? '';
}

/**
 * Resize the box the schema is laid out in, the way dragging a panel edge does.
 *
 * The panel's own resize handle is app chrome and is not mounted here, so this drives the thing the
 * handle ultimately does — the container's width changes — rather than the path it takes to do it.
 * That is the right simplification for what is being measured: the cost is the reflow and whatever
 * observers wake on it, none of which can tell how the width was set. What it deliberately does NOT
 * cover is the dock's own bookkeeping, which is a separate subject with its own surface.
 *
 * `steps` because one jump is not a drag: a real resize is a width change per frame, and the
 * interesting costs — an observer that forces layout each time — are per frame rather than per
 * gesture. A single set would under-report them by the length of the drag.
 */
async function resizeMount(from: number, to: number, steps = 8): Promise<void> {
  const host = document.getElementById('mount') as HTMLElement;
  for (let i = 1; i <= steps; i += 1) {
    host.style.width = `${Math.round(from + ((to - from) * i) / steps)}px`;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

/**
 * Add one row and let the subscription carry it, as a write does.
 *
 * The whole point of measuring an append rather than a mount: what a live call actually costs is
 * one more utterance against everything already said, and that path runs the subscription, the
 * query, the reconcile and the layout. `mutate` notifies subscribers exactly as the real backend's
 * change handlers do, so all of that happens; anything that skipped to the DOM would be measuring
 * the harness instead of the app.
 */
function addRow(table: string, row: Record<string, unknown>): void {
  if (!mountedBackend) throw new Error('nothing mounted to write into');
  mountedBackend.mutate((tables) => {
    (tables[table] ??= []).push(row as never);
  });
}

/** Make a peer's profile land, the way a fetch resolving does mid-call. */
function addProfile(did: string, name: string): void {
  if (!arriveProfile) throw new Error('nothing mounted to receive a profile');
  arriveProfile({ did, name, firstName: name, lastName: '', handle: name, bio: '' });
}

/**
 * Do nothing, for the same number of frames as the interaction being measured.
 *
 * The baseline every other figure is read against, and it has to match the *shape* of what it is
 * compared with or it is not a baseline. A drag is one width change per frame, so measuring it
 * spends eight frames waiting whatever the app does — and at ~16ms a frame that is most of the
 * number. Subtracting an idle run of the same length leaves the work rather than the waiting.
 */
async function idleFrames(frames = 1): Promise<void> {
  for (let i = 0; i < frames; i += 1) await new Promise((r) => requestAnimationFrame(() => r(null)));
}

injectDSInteropStyles();
(window as unknown as Record<string, unknown>).__harness = {
  mount,
  profile,
  resizeMount,
  addRow,
  addProfile,
  idleFrames,
  measure,
  measureAll,
  measurePart,
  measureControl,
  measureText,
  chain,
  pageColor,
  focused,
  html,
  scenarios: Object.keys(scenarios),
};
