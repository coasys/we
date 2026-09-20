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
import { render } from 'solid-js/web';

import { type Scenario, scenarios } from './scenarios';

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

function mount(name: string, width: number): void {
  disposeMount?.();
  const make = scenarios[name];
  if (!make) throw new Error(`unknown scenario "${name}" — have: ${Object.keys(scenarios).join(', ')}`);
  const scenario: Scenario = make();

  const backend = createInMemoryBackend({
    id: 'space-1',
    tables: scenario.tables as never,
    relations: scenario.relations,
  });

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
  const profiles = (stores.profileStore as { profiles?: { did: string }[] } | undefined)?.profiles ?? [];
  stores.$identities = {
    get: (did: string) => profiles.find((p) => p.did === did),
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
    lineHeight: cs.lineHeight,
    // Resolved, so a case can compare two states of the same element without knowing the theme's
    // ramp direction — which is the only way to assert "more present" rather than "lighter".
    color: cs.color,
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

/** What the page is painted on, for a case asking whether a colour stands out from it. */
function pageColor(): string {
  return getComputedStyle(document.body).backgroundColor;
}

/** The mounted tree as markup — what a failing assertion is looked at through. */
function html(): string {
  return document.getElementById('mount')?.innerHTML ?? '';
}

injectDSInteropStyles();
(window as unknown as Record<string, unknown>).__harness = {
  mount,
  measure,
  measureAll,
  measureText,
  chain,
  pageColor,
  html,
  scenarios: Object.keys(scenarios),
};
