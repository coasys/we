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
// The block system's stylesheet, as the app imports it (`@solid/index.ts`): a composer or a
// renderer measured without it is measured without its padding, its placeholder and its field.
import '@we/block-solid/styles';

import { edgeOfSnap } from '@shared/dockGeometry';
import {
  dockFrame,
  dockRegistry,
  registerHostDockStore,
  unregisterHostDockStore,
} from '@shared/registries/dockRegistry';
import { provideChromeBag } from '@shared/registries/templateBag';
import { setTemplatePanels } from '@shared/registries/templatePanels';
import { buildTemplateBag, CHROME_TIER, SPACE_TIER } from '@shared/registries/templateSurface';
import { hostSourceBag } from '@shared/sources';
import { EdgeLanes } from '@solid/components/EdgeLanes';
import { PanelHost } from '@solid/components/PanelHost';
import PanelLane from '@solid/components/PanelLane';
import { MissingMarker, PresentPart } from '@solid/components/PartFrame';
import { injectDSInteropStyles } from '@solid/dsInterop';
import { componentRegistry } from '@solid/registries/componentRegistry';
import { ShellStoreProvider, useShellStore } from '@solid/stores/ShellStore';
import { createInMemoryBackend } from '@we/backend-inmemory';
import { BlockHostProvider } from '@we/block-solid';
import { ToastContainer, toastService } from '@we/components/solid';
import {
  CopiedPartNote,
  EditingSectionBar,
  EditorHostProvider,
  EditorOverlay,
  EditTargetSwitch,
  OwnerCard,
  PartCard,
  PartsPalette,
  SectionOnItsOwnBar,
  SuppliedPanelNote,
  ThemePanel,
} from '@we/editor';
import {
  EDIT_SURFACE_ATTR,
  installGestureTracking,
  OWNER_ATTR,
  OWNER_NAME_ATTR,
  PART_ATTR,
  PART_NODE_ATTR,
  partForkPrint,
  VIEW_BOUNDARY_ATTR,
  VIEW_BOUNDARY_NAME_ATTR,
} from '@we/schema-shared';
import { applyThemeVars, clearThemeVars, setDisplayPreferences, setThemeLive } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { VisualEditorProvider } from '@we/schema-solid';
import { THEME_PRESETS } from '@we/themes/presets';
import { createComponent, createEffect, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { insert, render } from 'solid-js/web';

import { installLayoutCounter, profile } from './instrument';
import { type Scenario, scenarios } from './scenarios';

installLayoutCounter();
// As the app does, so a scenario rendered against a gated bag is judged by the same tracker.
installGestureTracking(window);

/*
  An element that answers late, standing in for one nobody here can edit — a library's custom element
  a deployment bundled. Pressed, it emits `done` a moment afterwards, once the press has finished
  dispatching; with `auto` it emits once after mounting with nobody pressing anything. The gesture
  gate must let the first through and refuse the second, without the element knowing it exists.
*/
customElements.define(
  'x-late-emitter',
  class extends HTMLElement {
    connectedCallback() {
      this.textContent = this.textContent || 'late';
      const emit = () => setTimeout(() => this.dispatchEvent(new CustomEvent('done')), 50);
      if (this.hasAttribute('auto')) emit();
      else this.addEventListener('click', emit);
    }
  },
);

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
  // A theme a previous case applied to the mount itself goes with its content.
  clearThemeVars(host);
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
  // A scenario about the trust boundary renders against what a space template is actually handed.
  const bag = scenario.bag === 'space' ? buildTemplateBag(stores, { grants: SPACE_TIER, gesture: 'enforce' }) : stores;
  /*
    The block host, as the app gives one (`TemplateProvider`): who a mention names, from the same
    profiles the scenario seeds. Without it a mention's hover card has nobody to show.
  */
  const person = (did: string) => {
    const known = identityOf[did] as { name?: string; avatar?: string } | undefined;
    return known ? { name: known.name, avatar: known.avatar } : undefined;
  };
  disposeMount = render(
    () =>
      createComponent(BlockHostProvider, {
        person,
        get children() {
          return RenderSchema({ node: scenario.node, stores: bag, registry: componentRegistry } as never) as never;
        },
      }),
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

/**
 * Every instance of one part in the nth host's shadow, unrounded — a 1px mark's centre is a half
 * pixel, and rounding it is the error a placement check is looking for.
 */
function measureParts(selector: string, part: string, nth = 0) {
  const host = document.querySelectorAll(selector)[nth];
  return [...(host?.shadowRoot?.querySelectorAll(`[part='${part}']`) ?? [])].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
}

/** One property of the nth element matching — a control's value, read rather than inferred. */
function prop(selector: string, name: string, nth = 0) {
  const el = document.querySelectorAll(selector)[nth] as unknown as Record<string, unknown> | undefined;
  return el?.[name];
}

/** Every element matching, so a case can assert about a row of siblings. */
function measureAll(selector: string) {
  return [...document.querySelectorAll(selector)].map(box);
}

/**
 * Every box under `selector` (itself included) that scrolls, with what it holds against what it shows.
 *
 * For "does this list get a scroll bar it has no need of" — which a box's size cannot answer, since a
 * scroller with a bar and one without are the same size. Light DOM only, like `measureAll`: slotted
 * content lives there, which is where a schema's own boxes are.
 */
function scrollers(selector: string) {
  const out: { tag: string; scrollH: number; clientH: number; scrollW: number; clientW: number }[] = [];
  for (const root of document.querySelectorAll(selector)) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const style = getComputedStyle(el);
      const scrolls = (v: string) => v === 'auto' || v === 'scroll' || v === 'overlay';
      if (!scrolls(style.overflowY) && !scrolls(style.overflowX)) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
      });
    }
  }
  return out;
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

/**
 * One computed style of the nth host's part — a colour read where it is painted.
 *
 * A primitive paints into its shadow root, so the host's own background is transparent; and a
 * colour role is a chain of variables a jsdom test can only compare as text. This is the resolved
 * colour, which is the only thing that says a re-pointed variable reached the thing it re-points.
 */
function partStyle(selector: string, property: string, part = 'base', nth = 0): string | null {
  const host = document.querySelectorAll(selector)[nth];
  // A part name, or a selector of its own when one part is not specific enough ("[aria-current]").
  // `row::before` reads the part's pseudo-element — a mark drawn without an element of its own.
  const [name, pseudo] = part.split('::');
  const inner = name.includes('[') ? name : `[part='${name}']`;
  const el = host?.shadowRoot?.querySelector(inner) ?? host;
  return el ? getComputedStyle(el, pseudo ? `::${pseudo}` : null).getPropertyValue(property) : null;
}

/** What a role resolves to at the document root, through a probe painted with it. */
function roleColor(role: string): string {
  return probeColor(`var(--we-role-${role})`);
}

/** What any CSS colour resolves to at the document root, through a probe painted with it. */
function probeColor(value: string): string {
  const probe = document.createElement('div');
  probe.style.backgroundColor = value;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
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

/**
 * The visual editor's overlay over a surface it used to be unable to reach.
 *
 * Mounts the real `EditorOverlay` in visual mode over three things: the template's content (marked as
 * an edit surface), a panel the template supplied (a fixed box at a panel's z-index, its body marked
 * too), and that panel's titlebar, which is the app's. Each holds a button that records being pressed,
 * and the editor's selection is recorded as well, so a case can ask which of the two heard a press.
 */
function editorProbe(): void {
  // Each run starts with nothing recorded: cases share the page, and one case's presses are not the
  // next case's evidence.
  for (const key of Object.keys(globalThis)) {
    if (key.startsWith('__probe')) delete (globalThis as unknown as Record<string, unknown>)[key];
  }
  const record = (key: string, value: unknown) => {
    const bag = globalThis as unknown as Record<string, unknown[]>;
    (bag[key] ??= []).push(value);
  };
  const node = (id: string, label: string) => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-we-node-id', id);
    const button = document.createElement('button');
    button.id = `probe-${id}`;
    button.textContent = label;
    button.style.cssText = 'width: 160px; height: 60px';
    button.style.cursor = 'pointer';
    button.addEventListener('click', () => record('__probePressed', id));
    // What a tooltip listens for. Nothing of the template's should hear the pointer while it is edited.
    button.addEventListener('pointerenter', () => record('__probeEntered', id));
    wrapper.append(button);
    return wrapper;
  };

  const content = document.createElement('div');
  content.setAttribute(EDIT_SURFACE_ATTR, '');
  content.style.cssText = 'position: fixed; left: 0; top: 0; width: 400px; height: 400px; z-index: 1;';
  content.append(node('n-content', 'content'));
  /*
    A section, as the shell's `$views` mounts one: a boundary naming the view, and inside it the
    view's own nodes — which carry ids of their own, derived for a built-in, that the template being
    edited does not contain.
  */
  const section = document.createElement('div');
  section.setAttribute(VIEW_BOUNDARY_ATTR, 'about');
  section.setAttribute(VIEW_BOUNDARY_NAME_ATTR, 'About');
  section.append(node('n-view-inner', 'section'));
  content.append(section);
  /*
    A part the template placed: the placement is the template's node, and inside it the part's own
    nodes, which are the module's — one of them stamped with an id of its own.
  */
  const placed = document.createElement('div');
  placed.setAttribute('data-we-node-id', 'n-part');
  const frame = document.createElement('div');
  frame.style.display = 'contents';
  frame.setAttribute(PART_ATTR, 'call.tile');
  frame.setAttribute(PART_NODE_ATTR, 'n-part');
  frame.append(node('n-part-inner', 'part'));
  placed.append(frame);
  content.append(placed);
  // A row of a list: the template's node, inside a `$each`, so a first press selects the list.
  content.append(node('n-row', 'row'));

  // A panel a module draws itself: an edit surface the editor can reach, owned by the module, inside
  // the dock's content box — which holds the surface rather than sitting in one, as the real dock's does.
  const owned = document.createElement('div');
  owned.setAttribute('data-we-dock-content', '');
  owned.style.cssText = 'position: fixed; left: 0; top: 460px; width: 200px; height: 80px; z-index: 1;';
  const ownedBody = document.createElement('div');
  ownedBody.setAttribute(EDIT_SURFACE_ATTR, '');
  ownedBody.setAttribute(OWNER_ATTR, 'panel:call:stage');
  ownedBody.setAttribute(OWNER_NAME_ATTR, 'Call');
  ownedBody.append(node('n-owned-inner', 'owned'));
  owned.append(ownedBody);
  document.body.append(owned);

  // A panel, painted where the dock registry paints them: above the content's whole context.
  const panel = document.createElement('div');
  panel.style.cssText =
    'position: fixed; left: 200px; top: 200px; width: 300px; height: 240px; z-index: 220; background: #eee;';
  const titlebar = document.createElement('button');
  titlebar.id = 'probe-titlebar';
  titlebar.textContent = 'titlebar';
  titlebar.addEventListener('click', () => record('__probePressed', 'titlebar'));
  const body = document.createElement('div');
  body.setAttribute(EDIT_SURFACE_ATTR, '');
  body.style.display = 'contents';
  body.append(node('n-panel', 'panel'));
  panel.append(titlebar, body);

  /*
    A tall node in a scroller, scrolled to its end — a transcript feed. The scroller lives in a shadow
    root, as `we-scroll-area`'s does, so what clips the node is only found by following its slot.
  */
  const scrolled = document.createElement('div');
  scrolled.setAttribute(EDIT_SURFACE_ATTR, '');
  scrolled.style.cssText = 'position: fixed; left: 210px; top: 460px; width: 100px; height: 100px; z-index: 1;';
  const scrollHost = document.createElement('div');
  scrollHost.id = 'probe-scroll-host';
  scrollHost.style.cssText = 'display: block; width: 100px; height: 100px;';
  const shadow = scrollHost.attachShadow({ mode: 'open' });
  const scroller = document.createElement('div');
  scroller.style.cssText = 'overflow: auto; height: 100%;';
  scroller.append(document.createElement('slot'));
  shadow.append(scroller);
  const long = node('n-long', 'long');
  Object.assign((long.firstElementChild as HTMLElement).style, { height: '400px', width: '80px' });
  scrollHost.append(long);
  scrolled.append(scrollHost);

  /*
    A list drawing one node three times — every comment's avatar is one node — and a copy of it, a
    second node drawn as many times, as copying a node inside a part leaves behind.
  */
  const list = document.createElement('div');
  list.setAttribute(EDIT_SURFACE_ATTR, '');
  list.style.cssText =
    'position: fixed; left: 0; top: 570px; width: 400px; height: 100px; z-index: 1; display: flex; gap: 8px;';
  const instance = (id: string, i: number) => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-we-node-id', id);
    const button = document.createElement('button');
    button.id = `probe-${id}-${i}`;
    button.textContent = `${id} ${i}`;
    button.style.cssText = 'width: 60px; height: 40px';
    wrapper.append(button);
    return wrapper;
  };
  for (let i = 0; i < 3; i++) list.append(instance('n-item', i));
  for (let i = 0; i < 3; i++) list.append(instance('n-copy', i));

  /*
    The app's chrome, as the host draws it: a box-less wrapper that is an edit surface only while the
    app is being edited, holding pieces that each position themselves — one node of the app's own, and
    the sidebar as a host part, whose frame has no box, inside which a Column sized to nothing holds a
    fixed, clipped column at the chrome's layer, as WE's sidebar is.
  */
  const appChrome = document.createElement('div');
  appChrome.setAttribute('data-we-app-chrome', '');
  appChrome.style.display = 'contents';
  const appOwn = document.createElement('div');
  appOwn.style.cssText = 'position: fixed; left: 0; top: 680px; width: 160px; height: 40px; z-index: 1;';
  appOwn.append(node('n-app-inner', 'app'));
  const sidebarPlaced = document.createElement('div');
  sidebarPlaced.setAttribute('data-we-node-id', 'n-sidebar');
  sidebarPlaced.style.display = 'contents';
  const sidebarFrame = document.createElement('div');
  sidebarFrame.style.display = 'contents';
  sidebarFrame.setAttribute(PART_ATTR, 'host.sidebar');
  sidebarFrame.setAttribute(PART_NODE_ATTR, 'n-sidebar');
  const sidebarRoot = document.createElement('div');
  sidebarRoot.setAttribute('data-we-node-id', 'n-sidebar-root');
  sidebarRoot.style.display = 'contents';
  const sidebarBox = document.createElement('div');
  sidebarBox.style.cssText =
    'position: fixed; left: 170px; top: 680px; width: 80px; height: 40px; overflow: hidden; z-index: 250; display: flex; flex-direction: column;';
  const sidebarItem = node('n-sidebar-item', 'side');
  (sidebarItem.firstElementChild as HTMLElement).style.width = '60px';
  sidebarBox.append(sidebarItem);
  // The Column the sidebar's root draws: a box of its own, sized to nothing, since all it holds is fixed.
  const sidebarColumn = document.createElement('div');
  sidebarColumn.style.cssText = 'display: flex; flex-direction: column;';
  sidebarColumn.append(sidebarBox);
  sidebarRoot.append(sidebarColumn);
  sidebarFrame.append(sidebarRoot);
  sidebarPlaced.append(sidebarFrame);
  appChrome.append(appOwn, sidebarPlaced);

  document.body.append(content, panel, scrolled, list, appChrome);
  scroller.scrollTop = 300;
  // The scenario mounted beside this one autofocuses a field, and a key typed there is typing — which
  // the editor rightly ignores. Nothing here should have focus to begin with.
  (document.activeElement as HTMLElement | null)?.blur();

  const template = {
    id: 'probe',
    type: 'Column',
    meta: { name: 'Probe', description: '', icon: '' },
    children: [
      { id: 'n-content', type: 'we-button' },
      { id: 'n-panel', type: 'we-button' },
      { id: 'n-part', type: '$part', props: { id: 'call.tile' } },
      { id: 'n-long', type: 'we-button' },
      { id: 'n-list', type: '$each', props: { items: [1] }, children: [{ id: 'n-row', type: 'we-button' }] },
      { id: 'n-items', type: '$each', props: { items: [1, 2, 3] }, children: [{ id: 'n-item', type: 'we-button' }] },
      { id: 'n-copies', type: '$each', props: { items: [1, 2, 3] }, children: [{ id: 'n-copy', type: 'we-button' }] },
    ],
  };
  const [selected, setSelected] = createSignal<string | null>(null);
  const [editingSection, setEditingSection] = createSignal<{ id: string; name: string } | null>(null);
  const [editingApp, setEditingApp] = createSignal(false);
  const appTemplate = {
    id: 'my-app',
    type: 'Column',
    meta: { name: 'My app', role: 'app' },
    children: [
      { id: 'n-app-inner', type: 'we-button' },
      { id: 'n-sidebar', type: '$part', props: { id: 'host.sidebar' } },
    ],
  };
  createEffect(() =>
    editingApp() ? appChrome.setAttribute(EDIT_SURFACE_ATTR, '') : appChrome.removeAttribute(EDIT_SURFACE_ATTR),
  );
  const aboutSection = {
    id: 'about',
    type: 'Column',
    meta: { name: 'About', role: 'view' },
    children: [{ id: 'n-view-inner', type: 'we-button' }],
  };
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [owner, setOwner] = createSignal<{ kind: string; id: string; name: string } | null>(null);
  const visual = {
    enabled: true,
    hoveredId: hovered,
    selectedId: selected,
    onHover: setHovered,
    // One selection at a time, as the app's provider keeps it: selecting a node clears the owner, and
    // the overlay has to survive that happening under an outline that is still drawn.
    onSelect: (id: string | null) => {
      setSelected(id);
      if (id) setOwner(null);
      record('__probeSelected', id);
    },
    selectedOwner: owner,
    onSelectOwner: (next: { kind: string; id: string } | null) => {
      setOwner(next as never);
      if (next) setSelected(null);
      record('__probeOwner', next ? `${next.kind}:${next.id}` : null);
    },
    registerNode: () => () => {},
    getNodeElement: (id: string) => document.querySelector(`[data-we-node-id="${id}"]`) as HTMLElement | null,
  };
  // A selection made for somebody rather than by a press — what copying a node inside a part does.
  probeSelect = (id: string | null) => visual.onSelect(id);
  probeEnterApp = () => host.targets.enterApp();
  const host = {
    session: { contentMode: () => 'visual', isStreaming: () => false, pushSnapshot() {}, commitEdit: async () => {} },
    // The template being edited: the one on screen, or the About section once it is gone into.
    template: {
      get currentTemplate() {
        return editingApp() ? appTemplate : editingSection() ? aboutSection : template;
      },
      updateTemplate: () => record('__probeUpdated', true),
    },
    // About is a section this agent may change, so a press can go into it and edit it where it is.
    targets: {
      section: editingSection,
      canEditSection: (id: string) => id === 'about',
      enterSection: (id: string) => {
        setEditingSection({ id, name: 'About' });
        record('__probeTarget', `section:${id}`);
        return true;
      },
      app: () => (editingApp() ? { name: 'My app' } : null),
      enterApp: () => {
        setEditingApp(true);
        record('__probeTarget', 'app');
        return true;
      },
      leave: () => {
        if (editingSection() || editingApp()) record('__probeTarget', 'screen');
        setEditingSection(null);
        setEditingApp(false);
      },
    },
    // Only what a ring asks about a part: what it is called and whose it is.
    owners: { part: (id: string) => ({ id, label: 'Tile', moduleName: 'Calls' }) },
  };

  const root = document.createElement('div');
  document.body.append(root);
  // Taken down by `editorProbeDispose`, so the next case on this page meets none of it.
  probeDisposers.push(() => {
    content.remove();
    scrolled.remove();
    list.remove();
    appChrome.remove();
    owned.remove();
    panel.remove();
    root.remove();
  });
  const dispose = render(
    () =>
      createComponent(EditorHostProvider, {
        value: host as never,
        get children() {
          return createComponent(VisualEditorProvider, {
            value: visual as never,
            get children() {
              return createComponent(EditorOverlay, {});
            },
          });
        },
      }),
    root,
  );
  probeDisposers.unshift(dispose);
}

/**
 * The inspector's card for a region somebody else provides, mounted against a host whose owners port
 * answers for one part and one module panel. What each route writes lands in `__probeTemplates`, as
 * the template it handed `updateTemplate`, so a case can read what taking a region over did.
 */
function ownerCardProbe(
  kind:
    | 'part'
    | 'panel'
    | 'palette'
    | 'view'
    | 'view-blocked'
    | 'view-editable'
    | 'arranged'
    | 'arranged-placed'
    | 'part-node'
    | 'copied-clean'
    | 'copied-inner'
    | 'copied-outer'
    | 'section-alone'
    | 'targets',
): void {
  const record = (key: string, value: unknown) => {
    const bag = globalThis as unknown as Record<string, unknown[]>;
    (bag[key] ??= []).push(value);
  };
  let template: Record<string, unknown> = {
    id: 'probe',
    type: 'Column',
    meta: { name: 'Probe', description: '', icon: '', panels: [{ id: 'stage', module: 'call', snap: 'right' }] },
    children: [{ id: 'aaaaaaaaaa', type: '$part', props: { id: 'demo.box', subject: { $: 'local.chosen' } } }],
  };
  // A module's panel this template has arranged: by arranging alone, or on an entry that also places it.
  if (kind === 'arranged' || kind === 'arranged-placed') {
    const arranged = { id: 'call-stage', module: 'call', dock: 'stage', node: { id: 'bbbbbbbbbb', type: 'Column' } };
    (template.meta as Record<string, unknown>).panels = [
      kind === 'arranged' ? arranged : { ...arranged, snap: 'right' },
    ];
  }
  /*
    A feed copied with the lines inside it — two copied levels, each fingerprinted as the copy makes
    them — then left alone, changed inside the lines (the avatar), or changed in the feed's own nodes.
  */
  if (kind.startsWith('copied-')) {
    const lines: Record<string, unknown> = {
      id: 'llllllllll',
      type: 'Column',
      forkedFrom: 'part:demo.lines',
      forkedPart: { placement: { id: 'demo.lines' }, print: '' },
      children: [{ id: 'vvvvvvvvvv', type: 'we-avatar', props: { size: 'sm' } }],
    };
    const feed: Record<string, unknown> = {
      id: 'ffffffffff',
      type: 'Column',
      forkedFrom: 'part:demo.feed',
      forkedPart: { placement: { id: 'demo.feed', subject: { $: 'local.chosen' } }, print: '' },
      children: [{ id: 'hhhhhhhhhh', type: 'we-text', children: ['Transcript'] }, lines],
    };
    (lines.forkedPart as { print: string }).print = partForkPrint(lines as never);
    (feed.forkedPart as { print: string }).print = partForkPrint(feed as never);
    if (kind === 'copied-inner')
      ((lines.children as Record<string, unknown>[])[0].props as Record<string, unknown>).size = 'lg';
    if (kind === 'copied-outer')
      ((feed.children as Record<string, unknown>[])[0].children as string[])[0] = 'What was said';
    template.children = [feed];
  }
  const [barApp, setBarApp] = createSignal<{ name: string } | null>(null);
  const host = {
    targets: {
      section: () => null,
      // Only the copy, and only where the shell draws it so it can be edited in place.
      canEditSection: (id: string) => kind === 'view-editable' && id === 'about-yours',
      enterSection: (id: string) => {
        record('__probeTarget', `section:${id}`);
        return true;
      },
      app: barApp,
      enterApp: () => {
        setBarApp({ name: 'WE' });
        return true;
      },
      leave: () => {
        setBarApp(null);
        record('__probeLeft', true);
      },
    },
    session: {
      // WE's app is built in, so while it is the target the session cannot save in place.
      isReadOnly: () => !!barApp(),
      pushSnapshot() {},
      commitEdit: async () => {},
      startFork: () => record('__probeForkStarted', true),
    },
    template: {
      get currentTemplate() {
        return template;
      },
      updateTemplate: (next: Record<string, unknown>) => {
        template = next;
        record('__probeTemplates', JSON.parse(JSON.stringify(next)));
      },
    },
    owners: {
      part: (id: string) => ({
        id,
        label: ({ 'demo.feed': 'Feed', 'demo.lines': 'Lines' } as Record<string, string>)[id] ?? 'Box',
        moduleId: 'demo',
        moduleName: 'Demo',
        inputs: [],
        missing: '',
      }),
      parts: () => [
        {
          id: 'demo.box',
          label: 'Box',
          description: 'A box.',
          moduleId: 'demo',
          moduleName: 'Demo',
          inputs: [],
          missing: '',
        },
      ],
      // The path to a node inside the part: the part opened a level, the node somebody pressed in it,
      // and a piece beside the path that stays the module's.
      openPath: () => {
        const target = { id: 'cccccccccc', type: 'we-avatar' };
        return {
          node: {
            type: 'Column',
            forkedFrom: 'part:demo.box',
            children: [target, { type: '$part', props: { id: 'demo.inner' } }],
          },
          target,
          parts: ['demo.box'],
        };
      },
      // As the real port does, each level opened says which part it was and which placement it replaced.
      openPart: (placement: { props?: Record<string, unknown> }, depth: 'one' | 'all') => ({
        type: 'Column',
        forkedFrom: 'part:demo.box',
        forkedPart: { placement: placement.props ?? {}, print: '' },
        children:
          depth === 'one'
            ? [{ type: '$part', props: { id: 'demo.inner' } }]
            : [{ type: 'we-text', children: ['inner'] }],
      }),
      panel: () => ({
        dockId: 'call:stage',
        moduleId: 'call',
        moduleName: 'Calls',
        dock: 'stage',
        title: 'Call',
        composed: true,
        placed: ['Tile'],
      }),
      panelNode: () => ({ type: 'Column', children: [{ type: '$part', props: { id: 'call.tile' } }] }),
      view: () => ({
        id: 'about',
        name: 'About',
        source: 'built into WE',
        forkBlocked: kind === 'view-blocked' ? 'Only whoever runs this space can replace its sections.' : '',
      }),
      forkView: async (id: string) => {
        record('__probeForked', id);
        return 'about-yours';
      },
      openTemplate: (id: string) => record('__probeOpened', id),
      sectionOnItsOwn: () =>
        kind === 'section-alone'
          ? { section: 'About (yours)', shell: { name: 'My shell', back: () => record('__probeBack', true) } }
          : null,
    },
  };
  const visual = {
    enabled: true,
    selectedId: () => null,
    hoveredId: () => null,
    onHover() {},
    onSelect: (id: string | null) => record('__probeSelected', id),
    selectedOwner: () => null,
    onSelectOwner() {},
    registerNode: () => () => {},
    getNodeElement: () => null,
  };
  const root = document.createElement('div');
  root.style.cssText = 'position: fixed; left: 0; top: 0; width: 320px;';
  document.body.append(root);
  probeDisposers.push(() => root.remove());
  const dispose = render(
    () =>
      createComponent(EditorHostProvider, {
        value: host as never,
        get children() {
          return createComponent(VisualEditorProvider, {
            value: visual as never,
            get children() {
              if (kind === 'palette') return createComponent(PartsPalette, { node: template as never });
              if (kind === 'arranged' || kind === 'arranged-placed')
                return createComponent(SuppliedPanelNote, { nodeId: 'bbbbbbbbbb' });
              if (kind.startsWith('copied-')) return createComponent(CopiedPartNote, { nodeId: 'vvvvvvvvvv' });
              if (kind === 'section-alone') return createComponent(SectionOnItsOwnBar, {});
              if (kind === 'targets')
                return [createComponent(EditTargetSwitch, {}), createComponent(EditingSectionBar, {})];
              if (kind === 'part-node')
                return createComponent(OwnerCard, {
                  owner: {
                    kind: 'part-node',
                    id: 'cccccccccc',
                    name: 'Avatar',
                    chain: ['aaaaaaaaaa'],
                    parts: ['demo.box'],
                  },
                });
              if (kind === 'view' || kind === 'view-blocked' || kind === 'view-editable')
                return createComponent(OwnerCard, { owner: { kind: 'view', id: 'about', name: 'About' } });
              return kind === 'part'
                ? createComponent(PartCard, { node: (template.children as Record<string, unknown>[])[0] as never })
                : createComponent(OwnerCard, { owner: { kind: 'panel', id: 'call:stage', name: 'Call' } });
            },
          });
        },
      }),
    root,
  );
  probeDisposers.unshift(dispose);
}

/**
 * Press the button in the probe whose words are these — what a route's button says. Answers whether
 * there was one to press, and a disabled one counts as none: it would not have done anything either.
 */
function pressButton(words: string): boolean {
  const button = [...document.querySelectorAll('we-button')].find((b) => b.textContent?.trim() === words) as
    (HTMLElement & { disabled?: boolean }) | undefined;
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

/** Press the last "Give back" — the one that returns only what was not changed. */
function pressGiveBackUnchanged(): boolean {
  const buttons = [...document.querySelectorAll('we-button')].filter((b) => b.textContent?.trim() === 'Give back');
  const last = buttons.at(-1) as HTMLElement | undefined;
  last?.click();
  return !!last;
}

/**
 * A page over the template, standing in for settings opened mid-edit: a fixed sheet above the content,
 * as the shell's own view is.
 */
function editorProbeCover(on: boolean): void {
  const existing = document.getElementById('probe-cover');
  if (!on) return existing?.remove();
  if (existing) return;
  const cover = document.createElement('div');
  cover.id = 'probe-cover';
  cover.style.cssText = 'position: fixed; left: 0; top: 0; width: 400px; height: 400px; z-index: 50; background: #fff;';
  document.body.append(cover);
  probeDisposers.push(() => cover.remove());
}

/**
 * Records where one element's top edge is on every frame for `ms`, into `globalThis[key]` — for a
 * case about motion, which a measurement after the fact cannot see. Returns at once, so the case can
 * start the gesture that causes the motion while the frames are being counted.
 */
function sampleTop(selector: string, key: string, ms: number): void {
  const bag = globalThis as unknown as Record<string, number[]>;
  const samples: number[] = (bag[key] = []);
  const until = performance.now() + ms;
  const frame = () => {
    const el = document.querySelector(selector);
    if (el) samples.push(Math.round(el.getBoundingClientRect().top));
    if (performance.now() < until) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const probeDisposers: (() => void)[] = [];

/*
  Docked panels, as the app draws them: the real shell store, panels registered and declared as a
  template declares them, their frames, and a box standing for the space, inset exactly as
  `TemplateLayout` insets it. Cases read every panel's box (`dockProbeBoxes`) — by the attribute a
  panel's frame carries, so they hold whatever draws the panel.
*/
interface DockProbePanel {
  id: string;
  snap: 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  displace?: boolean;
  band?: number;
  order?: number;
  grow?: number;
  width?: number;
  frame?: 'window' | 'flush' | 'none';
  /** At home in the probe's template lane (`probe`), drawn on the left in the page's flow. */
  home?: boolean;
}
let dockProbeShell: ReturnType<typeof useShellStore> | undefined;
function dockProbe(panels: DockProbePanel[]): void {
  // A clean arrangement: what an earlier probe left stored (a stowed lane, a dragged card) is not this one's.
  for (const key of Object.keys(localStorage)) if (key.startsWith('we-local:shell.')) localStorage.removeItem(key);
  // In a space: at the root address the shell opens its landing page, and panels stand aside for it.
  const address = window.location.pathname;
  window.history.replaceState({}, '', '/space/probe');
  const keys: Record<string, unknown> = {};
  for (const panel of panels) {
    keys[`edge:${panel.id}`] = () => edgeOfSnap(panel.snap) ?? 'right';
    keys[`size:${panel.id}`] = () => 'md';
    keys[`float:${panel.id}`] = () => !panel.displace;
  }
  registerHostDockStore('probe', keys);
  const entries = panels.map((panel) => {
    const entry = {
      id: `probe:${panel.id}`,
      moduleId: 'probe',
      name: panel.id,
      title: panel.id,
      edge: `edge:${panel.id}`,
      size: `size:${panel.id}`,
      float: `float:${panel.id}`,
      node: { type: 'Column' },
    };
    dockRegistry.register(entry as never);
    return entry;
  });
  setTemplatePanels(
    panels.map((panel) => ({
      id: panel.id,
      module: 'probe',
      dock: panel.id,
      snap: panel.snap,
      ...(panel.displace ? { displace: true } : {}),
      ...(panel.band !== undefined ? { band: panel.band } : {}),
      ...(panel.order !== undefined ? { order: panel.order } : {}),
      ...(panel.grow !== undefined ? { grow: panel.grow } : {}),
      ...(panel.width ? { box: { width: panel.width } } : {}),
      ...(panel.frame ? { frame: panel.frame } : {}),
      ...(panel.home ? { home: 'probe' } : {}),
    })),
    'dock-probe',
  );
  const root = document.createElement('div');
  document.body.append(root);
  probeDisposers.push(() => {
    root.remove();
    window.history.replaceState({}, '', address);
    setTemplatePanels(undefined);
    for (const entry of entries) dockRegistry.remove(entry.id);
    unregisterHostDockStore('probe');
    dockProbeShell = undefined;
  });
  const Chrome = () => {
    const shellStore = useShellStore();
    dockProbeShell = shellStore;
    // Wrapped as the app wraps chrome's stores, so an expression reads a member's value, not its accessor.
    const bag = buildTemplateBag({ shellStore } as never, { grants: CHROME_TIER }) as never;
    provideChromeBag(bag);
    const frames = entries.map((entry) =>
      RenderSchema({
        node: dockFrame(entry as never, {
          type: 'Column',
          props: { id: `content-${entry.name}`, height: '100%' },
          children: [entry.name],
        }),
        stores: bag,
        registry: componentRegistry,
      }),
    );
    const space = document.createElement('div');
    space.id = 'probe-space';
    space.style.position = 'fixed';
    createEffect(() => {
      const inset = shellStore.contentInset();
      Object.assign(space.style, {
        left: `${inset.left}px`,
        right: `${inset.right}px`,
        top: `${inset.top}px`,
        bottom: `${inset.bottom}px`,
      });
    });
    // A template's lane, for panels at home: a column down the left of the window, as a sidebar is.
    const lane = document.createElement('div');
    lane.id = 'probe-lane';
    Object.assign(lane.style, { position: 'fixed', left: '0', top: '0', bottom: '0', width: '300px', display: 'flex' });
    const laneChildren = panels.some((panel) => panel.home)
      ? [createComponent(PanelLane, { lane: 'probe', flex: '1', direction: 'column' })]
      : [];
    insert(lane, () => laneChildren);
    return [space, lane, ...frames, createComponent(EdgeLanes, {}), createComponent(PanelHost, {})];
  };
  const dispose = render(
    () =>
      createComponent(ShellStoreProvider, {
        get children() {
          return createComponent(Chrome, {});
        },
      }),
    root,
  );
  probeDisposers.unshift(dispose);
}

/** A shell store action, by name — `toggleStowLane`, `toggleCollapseDock`, … — on a probe panel. */
function dockProbeAct(action: string, id: string): void {
  const fn = (dockProbeShell as unknown as Record<string, (id: string) => void> | undefined)?.[action];
  fn?.(`probe:${id}`);
}

/** Where a panel being dragged could land now — the store's insert slots and snap targets, as boxes. */
function dockProbeTargets(): {
  slots: { key: string; mode: string; edge: string; lane: string; x: number; y: number }[];
  snaps: { id: string; left: number; top: number; width: number; height: number }[];
} {
  const n = (value: string | number | undefined) => parseFloat(String(value ?? '0'));
  const shell = dockProbeShell as unknown as {
    insertSlots: () => (Record<string, string | number> & { hit: { x: number; y: number; w: number; h: number } })[];
    snapTargets: () => Record<string, string>[];
  };
  return {
    slots: (shell?.insertSlots() ?? []).map((slot) => ({
      key: String(slot.key),
      mode: String(slot.mode),
      edge: String(slot.edge ?? ''),
      lane: String(slot.lane ?? ''),
      // The middle of where it answers the pointer — where a hand aims.
      x: slot.hit.x + slot.hit.w / 2,
      y: slot.hit.y + slot.hit.h / 2,
    })),
    snaps: (shell?.snapTargets() ?? []).map((snap) => ({
      id: snap.id,
      left: n(snap.left),
      top: n(snap.top),
      width: n(snap.width),
      height: n(snap.height),
    })),
  };
}

/** Every probe panel's box on screen and whether it shows, by id, and the space's box. */
function dockProbeBoxes(): Record<
  string,
  { left: number; top: number; right: number; bottom: number; visible: boolean }
> {
  const out: Record<string, { left: number; top: number; right: number; bottom: number; visible: boolean }> = {};
  const read = (el: Element) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const visible =
      r.width > 0 &&
      r.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number(style.opacity) > 0;
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      visible,
    };
  };
  for (const el of document.querySelectorAll('[data-we-dock-frame]')) {
    const id = (el.getAttribute('data-we-dock-frame') ?? '').replace(/^probe:/, '');
    const box = read(el);
    // A panel drawn in more than one place keeps the one that shows.
    if (!out[id] || (!out[id].visible && box.visible)) out[id] = box;
  }
  const space = document.getElementById('probe-space');
  if (space) out.$space = read(space);
  out.$window = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, visible: true };
  return out;
}

/**
 * A placed part that draws nothing right now — a microphone meter outside a call — mounted in the
 * real frame, with whether the template is being edited and whether the part draws anything driven
 * from the case.
 */
let setPartEditing: (on: boolean) => void = () => {};
let setPartDraws: (on: boolean) => void = () => {};
function emptyPartProbe(): void {
  const [editing, setEditing] = createSignal(true);
  const [draws, setDraws] = createSignal(false);
  setPartEditing = setEditing;
  setPartDraws = setDraws;
  const root = document.createElement('div');
  root.style.cssText = 'position: fixed; left: 0; top: 0; width: 320px;';
  document.body.append(root);
  probeDisposers.push(() => root.remove());
  const dispose = render(
    () =>
      createComponent(PresentPart, {
        part: 'transcribe.captureMeter',
        at: 'pppppppppp',
        get editing() {
          return editing();
        },
        get children() {
          const content = document.createElement('div');
          content.id = 'probe-part-content';
          content.style.height = '20px';
          content.style.display = draws() ? 'block' : 'none';
          return content;
        },
      }),
    root,
  );
  probeDisposers.unshift(dispose);
}
/**
 * What stands where a part's module is off: the real marker, editing or not, with a fix to offer or
 * none — which is what somebody who cannot turn the module on gets.
 */
function missingPartProbe(mode: 'editing' | 'fixable' | 'unfixable'): void {
  const record = (key: string, value: unknown) => {
    const bag = globalThis as unknown as Record<string, unknown[]>;
    (bag[key] ??= []).push(value);
  };
  const root = document.createElement('div');
  root.id = 'probe-missing-row';
  root.style.cssText = 'position: fixed; left: 0; top: 0; width: 320px; display: flex; align-items: center; gap: 8px;';
  document.body.append(root);
  probeDisposers.push(() => root.remove());
  const dispose = render(
    () =>
      createComponent(MissingMarker, {
        label: 'Continue call',
        reason: 'Calls is turned off in this space.',
        editing: mode === 'editing',
        ...(mode === 'unfixable'
          ? {}
          : { fix: { label: 'Open space settings', go: () => record('__probeFixed', true) } }),
      }),
    root,
  );
  probeDisposers.unshift(dispose);
}

function emptyPartEditing(on: boolean): void {
  setPartEditing(on);
}
function emptyPartDraws(on: boolean): void {
  setPartDraws(on);
}
let probeSelect: (id: string | null) => void = () => {};
let probeEnterApp: () => void = () => {};
function editorProbeEnterApp(): void {
  probeEnterApp();
}
function editorProbeSelect(id: string | null): void {
  probeSelect(id);
}
function editorProbeDispose(): void {
  for (const dispose of probeDisposers.splice(0)) dispose();
}

injectDSInteropStyles();
/** The compact composer's own box: its edge and its height, and the send button's height beside it. */
function composerFrame(): { border: string; height: number; button: number } | null {
  const box = document.querySelector('.we-block-composer--compact');
  const button = document.querySelector('we-button');
  if (!box) return null;
  const cs = getComputedStyle(box);
  return {
    border: `${cs.borderTopWidth} ${cs.borderTopStyle}`,
    height: Math.round(box.getBoundingClientRect().height),
    button: Math.round(button?.getBoundingClientRect().height ?? 0),
  };
}

/**
 * What one frame of a theme-slider drag costs: the theme re-applied to each root the editor applies
 * it to, with the hue moving each step, then the style and layout the browser owes for it. `roots`
 * is how many — the document alone, or the document, the mount (standing in for a scoped space) and
 * a preview box, as the theme panel does. `live` holds measuring until the drag ends, as the panel
 * does while a slider is held. Medians, in milliseconds.
 */
async function themeDrag(steps: number, roots: number, live = false): Promise<{ median: number; max: number }> {
  const preview = document.createElement('div');
  preview.innerHTML = '<we-button>Preview</we-button><we-badge>badge</we-badge>'.repeat(10);
  document.body.appendChild(preview);
  const targets = [document.documentElement, document.getElementById('mount') as HTMLElement, preview].slice(0, roots);
  const base = THEME_PRESETS.dark.parameters;
  const times: number[] = [];
  setThemeLive(live);
  for (let i = 0; i < steps; i++) {
    const t0 = performance.now();
    for (const root of targets) applyThemeVars(root, { ...base, accentHue: 200 + i * 7 }, { crossFade: false });
    document.body.getBoundingClientRect();
    times.push(performance.now() - t0);
    await new Promise((r) => requestAnimationFrame(r));
  }
  setThemeLive(false);
  // Taken off again, or every case after this one renders inside the theme the drag left behind.
  for (const root of targets) clearThemeVars(root);
  preview.remove();
  times.sort((a, b) => a - b);
  return {
    median: Math.round(times[Math.floor(times.length / 2)] * 10) / 10,
    max: Math.round(times[times.length - 1]),
  };
}

/**
 * The theme panel, mounted against a host editing one theme — a fork of `dark` unless told otherwise
 * — so a case can photograph or measure the panel itself. Its writes land in the theme it shows.
 */
function themePanelProbe(overrides = '{"themeName":"dark"}'): void {
  const [editing, setEditing] = createSignal({ id: 'probe', name: 'Probe', icon: 'palette', overrides, css: '' });
  const theme = {
    editingTheme: editing,
    focusedRole: () => '',
    saveEditingTheme: async () => null,
    startEditing: () => {},
    changeBasePreset: () => {},
    updateEditingCss: (css: string) => setEditing((t) => ({ ...t, css })),
    updateEditingMeta: (meta: Record<string, string>) => setEditing((t) => ({ ...t, ...meta })),
    updateEditingOverrides: (patch: Record<string, unknown>) =>
      setEditing((t) => ({ ...t, overrides: JSON.stringify({ ...JSON.parse(t.overrides), ...patch }) })),
  };
  const host = document.getElementById('mount') as HTMLElement;
  host.innerHTML = '';
  const dispose = render(
    () =>
      createComponent(EditorHostProvider, {
        value: { theme } as never,
        get children() {
          return createComponent(ThemePanel, {});
        },
      }),
    host,
  );
  probeDisposers.unshift(dispose);
}

/**
 * The app's toast stack, mounted with one toast raised, so a case can measure how a toast lays out.
 * Returns the toast's id; the container stays until the next case clears the mount.
 */
function toastProbe(message: string, actionLabel = ''): string {
  const host = document.getElementById('mount') as HTMLElement;
  host.innerHTML = '';
  const dispose = render(() => createComponent(ToastContainer, {}), host);
  probeDisposers.unshift(dispose);
  const id = toastService.info(message, 0, actionLabel ? { label: actionLabel, run: () => {} } : undefined);
  // A toast with no timeout outlives the container; take it down with the case.
  probeDisposers.unshift(() => toastService.remove(id));
  return id;
}

(window as unknown as Record<string, unknown>).__harness = {
  toastProbe,
  dockProbe,
  dockProbeAct,
  dockProbeBoxes,
  dockProbeTargets,
  // The theme pipeline itself, for a probe of how an apply behaves.
  themeApi: { applyThemeVars, clearThemeVars, setDisplayPreferences, setThemeLive },
  themeDrag,
  themePanelProbe,
  composerFrame,
  editorProbe,
  editorProbeCover,
  ownerCardProbe,
  pressButton,
  pressGiveBackUnchanged,
  editorProbeDispose,
  editorProbeSelect,
  editorProbeEnterApp,
  emptyPartProbe,
  missingPartProbe,
  emptyPartEditing,
  emptyPartDraws,
  sampleTop,
  mount,
  profile,
  resizeMount,
  addRow,
  addProfile,
  idleFrames,
  measure,
  measureAll,
  scrollers,
  measurePart,
  measureParts,
  prop,
  measureControl,
  measureText,
  chain,
  pageColor,
  partStyle,
  roleColor,
  probeColor,
  focused,
  html,
  scenarios: Object.keys(scenarios),
};
