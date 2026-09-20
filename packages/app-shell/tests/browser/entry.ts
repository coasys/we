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

/** A box and the handful of computed values a layout assertion actually reads. */
function measure(selector: string) {
  const el = document.querySelector(selector);
  if (!el) return null;
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
    text: (el.textContent ?? '').trim().slice(0, 80),
  };
}

/** Every element matching, so a case can assert about a row of siblings. */
function measureAll(selector: string) {
  return [...document.querySelectorAll(selector)].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
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
  html,
  scenarios: Object.keys(scenarios),
};
