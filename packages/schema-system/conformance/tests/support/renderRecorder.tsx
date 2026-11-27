/**
 * Records renderer vectors: mounts a case's template through the real renderer on jsdom, runs its
 * steps, and after the mount and after every step reports the rendered tree — as a renderer-neutral
 * description, not as HTML — and the actions the step fired, in order.
 *
 * What is real: `RenderSchema` and everything under it, the host's part expansion (`resolveParts`),
 * its router glue (`buildRoutes` over a memory router), its gesture gate (`buildTemplateBag`) and
 * gesture tracking. What is a stand-in: the component registry. Layout components are probes that
 * draw their resolved props and children and nothing else — what a component then does with its
 * props is that component's contract, not the renderer's.
 *
 * ## The tree
 *
 * - An element node: `{ type, props?, slot?, children? }`. `type` is the node type the template wrote.
 *   `props` are what the renderer handed over: for a probe component its resolved props, for a custom
 *   element the properties it set (and `data-`/`aria-` attributes), for a native element its
 *   attributes. Handlers are not listed — what they do is in `actions`. `slot` is set when the node
 *   went into a web component's named slot.
 * - A named slot a component received: `{ slot: name, children }` inside that component.
 * - Text: a string. Adjacent text is joined; empty text is dropped.
 * - The missing marker: `{ missing: type, reason }`, the reason one of `unknown-component`,
 *   `unknown-element` (a `we-*` element nobody defined), `missing-definition` and
 *   `cyclic-definition` (a `$ref` with no shape to stand for).
 * - A `$surface` boundary: `{ type: '$surface', children }` — the box, without its measuring element.
 * - A panel body: `{ panel: id, children }`, after the root's tree, one per `meta.panels` entry that
 *   carries a node, in order. Each is drawn as the host draws one — a pass of its own, mounted outside
 *   the root's tree, given the root's scope and `panel` (`{ id, inputs: {} }`).
 *
 * The renderer's own wrappers (one box-less `div` around every node) are not part of the tree.
 */
import { createMemoryHistory, MemoryRouter, useNavigate, useParams } from '@solidjs/router';
import { render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';

import { buildRoutes } from '../../../../app-shell/src/frameworks/solid/utils/buildRoutes.tsx';
import { resolveParts } from '../../../../app-shell/src/shared/registries/moduleParts.ts';
import {
  buildTemplateBag,
  CAPABILITY_GROUPS,
  type CapabilityGroup,
} from '../../../../app-shell/src/shared/registries/templateSurface.ts';
import { type PassScope, RenderSchema } from '../../../frameworks/solid/src/index.ts';
import type { RouteSchema, SchemaNode } from '../../../shared/src/index.ts';
import { installGestureTracking } from '../../../shared/src/index.ts';
import { panelsOf } from '../../../shared/src/treeUtils.ts';
import type { RenderCase, RenderStep } from '../../src/cases/render.ts';
import { type EncodedValue, encodeValue } from '../../src/encode.ts';

export type RenderedNode =
  | string
  | { missing: string; reason: string }
  | { slot: string; children: RenderedNode[] }
  | { panel: string; children: RenderedNode[] }
  | { type: string; props?: Record<string, EncodedValue>; slot?: string; children?: RenderedNode[] };

export interface RenderExpect {
  tree: RenderedNode[];
  /** The store methods called since the last entry, in order. */
  actions: { call: string; args: EncodedValue[] }[];
  /** The URL query parameters, when the case declares any or a field syncs one. */
  params?: Record<string, string>;
  /** Device storage under `we-local:`, when the case declares any or a field persists. */
  storage?: Record<string, string>;
  /** The destructive actions the host asked the person about, when the case names its grants. */
  confirmations?: { call: string; args: EncodedValue[] }[];
}

/** Layout components drawn as probes. Anything PascalCase not listed is an unknown component. */
/**
 * `FlipCard` stands for a component that declares node props (its `front` and `back` are element-typed
 * in its declaration): what it is handed there is drawn, and arrives like a slot.
 */
const PROBES = ['Column', 'Row', 'Card', 'Grid', 'PartFrame', 'PanelLane', 'FlipCard'] as const;
const PROBE_TAG = 'x-probe';
const SLOT_TAG = 'x-probe-slot';
const PANEL_TAG = 'x-probe-panel';

const probeProps = new WeakMap<Element, Record<string, unknown>>();

const isEventKey = (key: string) => key.length > 2 && key.startsWith('on') && key[2] === key[2].toUpperCase();
const isRendered = (value: unknown): boolean =>
  value instanceof Node ||
  (Array.isArray(value) && value.length > 0 && value.every((v) => v instanceof Node || typeof v === 'function'));

function probe(type: string) {
  return (props: Record<string, unknown> & { children?: JSX.Element }) => {
    // A slot arrives as a prop holding what the renderer drew for it.
    const slots = Object.keys(props).filter((key) => key !== 'children' && isRendered(props[key]));
    return (
      <x-probe attr:data-type={type} ref={(el: Element) => void probeProps.set(el, props)}>
        {slots.map((name) => (
          <x-probe-slot attr:data-name={name}>{props[name] as JSX.Element}</x-probe-slot>
        ))}
        {props.children}
      </x-probe>
    );
  };
}

const registry = Object.fromEntries(PROBES.map((name) => [name, probe(name)]));

/** The renderer's own wrapper: box-less, carrying nothing but where it is slotted and themed. */
function isWrapper(el: Element): boolean {
  if (el.tagName !== 'DIV') return false;
  const style = el.getAttribute('style') ?? '';
  if (!/display:\s*contents/.test(style)) return false;
  return [...el.attributes].every((a) => ['style', 'slot', 'data-we-theme', 'data-we-node-id'].includes(a.name));
}

function encodeProps(entries: [string, unknown][]): Record<string, EncodedValue> | undefined {
  const out: Record<string, EncodedValue> = {};
  for (const [key, value] of entries) {
    if (isEventKey(key) || value === undefined) continue;
    out[key] = encodeValue(value);
  }
  return Object.keys(out).length ? out : undefined;
}

function describeChildren(parent: Node, skip: (node: Node) => boolean = () => false): RenderedNode[] {
  const out: RenderedNode[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (typeof last === 'string') out[out.length - 1] = last + text;
    else out.push(text);
  };
  const visit = (node: Node, slot?: string) => {
    if (node.nodeType === Node.TEXT_NODE) return pushText(node.textContent ?? '');
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (isWrapper(el)) {
      const into = el.getAttribute('slot') ?? slot;
      el.childNodes.forEach((child) => visit(child, into));
      return;
    }
    const described = describe(el);
    if (slot && typeof described === 'object' && 'type' in described) described.slot = slot;
    out.push(described);
  };
  parent.childNodes.forEach((child) => !skip(child) && visit(child));
  return out;
}

function describe(el: Element): RenderedNode {
  const missing = el.getAttribute('data-we-missing-component');
  if (missing !== null) {
    const reason = el.getAttribute('data-we-missing-reason');
    return { missing, reason: reason ?? '' };
  }
  // A responsive boundary is a box of its own; the element it measures its tier with is not content.
  if (el.hasAttribute('data-we-surface')) {
    const tier = (n: Node) => n instanceof Element && n.hasAttribute('data-we-surface-tier');
    return { type: '$surface', children: describeChildren(el, tier) };
  }
  if (el.tagName === PANEL_TAG.toUpperCase()) {
    return { panel: el.getAttribute('data-id') ?? '', children: describeChildren(el) };
  }
  if (el.tagName === SLOT_TAG.toUpperCase()) {
    return { slot: el.getAttribute('data-name') ?? '', children: describeChildren(el) };
  }
  let type: string;
  let props: Record<string, EncodedValue> | undefined;
  if (el.tagName === PROBE_TAG.toUpperCase()) {
    type = el.getAttribute('data-type') ?? '';
    const given = probeProps.get(el) ?? {};
    props = encodeProps(
      Object.keys(given)
        .filter((key) => key !== 'children' && !isRendered(given[key]))
        .map((key) => [key, given[key]]),
    );
  } else {
    type = el.tagName.toLowerCase();
    const attributes: [string, unknown][] = [...el.attributes].map((a) => [a.name, a.value]);
    // A custom element's props are properties it was given — its own, enumerable ones.
    const own: [string, unknown][] = type.includes('-')
      ? Object.keys(el)
          .filter((key) => !key.startsWith('$$') && !key.startsWith('_$'))
          .map((key) => [key, (el as unknown as Record<string, unknown>)[key]])
      : [];
    props = encodeProps([...attributes, ...own]);
  }
  const children = describeChildren(el);
  return { type, ...(props ? { props } : {}), ...(children.length ? { children } : {}) };
}

/** Let effects, promises and the router's queued work finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

function target(container: Element, name: string): Element {
  const found =
    container.querySelector(`[data-case="${name}"]`) ??
    [...container.querySelectorAll('*')].find((el) => (el as unknown as Record<string, unknown>)['data-case'] === name);
  if (!found) throw new Error(`no element with data-case="${name}"`);
  return found;
}

const ALL_GROUPS = Object.keys(CAPABILITY_GROUPS) as CapabilityGroup[];

/** Run one case and report the tree after the mount and after each step. */
export async function runRenderCase(c: RenderCase): Promise<RenderExpect[]> {
  localStorage.clear();
  for (const [key, value] of Object.entries(c.storage ?? {})) localStorage.setItem(key, value);
  const stopTracking = installGestureTracking(window, { requireTrusted: false });

  // The data, held reactively so a `data` step is a change the template follows.
  const setters: Record<string, SetStoreFunction<Record<string, unknown>>> = {};
  const stores: Record<string, unknown> = {};
  for (const [name, members] of Object.entries(c.data ?? {})) {
    const [store, set] = createStore<Record<string, unknown>>(structuredClone(members));
    stores[name] = store;
    setters[name] = set;
  }

  // The actions, each recording its calls.
  let calls: RenderExpect['actions'] = [];
  const gatedStores: Record<string, Record<string, unknown>> = {};
  for (const [path, outcome] of Object.entries(c.actions ?? {})) {
    const [store, method] = path.split('.');
    const fn = (...args: unknown[]) => {
      calls.push({ call: path, args: args.map(encodeValue) });
      if ('reject' in outcome) return Promise.reject(new Error(outcome.reject));
      if ('resolve' in outcome) return Promise.resolve(outcome.resolve);
      return outcome.returns;
    };
    const into = c.gated?.includes(path) ? gatedStores : (stores as Record<string, Record<string, unknown>>);
    (into[store] ??= {})[method] = fn;
  }
  if (Object.keys(gatedStores).length) {
    Object.assign(stores, buildTemplateBag(gatedStores, { grants: ALL_GROUPS, gesture: 'enforce' }));
  }

  // The profiles `$agent` reads: known ones answer at once, others are asked for and never arrive.
  const identities = c.identities ?? {};
  stores.$identities = { get: (did: string) => identities[did], fetch: () => {} };

  // The URL parameters a syncParam field reads and writes.
  const params = new Map(Object.entries(c.params ?? {}));
  let tracksParams = params.size > 0;
  stores.$routeParams = {
    get: (name: string) => params.get(name),
    set: (name: string, value: string | null) => {
      tracksParams = true;
      if (value === null) params.delete(name);
      else params.set(name, value);
    },
  };

  // The routes, under a memory router; `routeStore.params` is the router's.
  const template = resolveParts(structuredClone(c.template)) as SchemaNode;
  const { routes, ...root } = template as SchemaNode & { routes?: RouteSchema[] };
  let navigate: ((to: string) => void) | undefined;
  let routeParams: () => Record<string, string> = () => ({});
  // A case drawn through the host's bag may hand the router actions of its own; its params stay the router's.
  const routerActions = c.grants ? (stores.routeStore as Record<string, unknown> | undefined) : undefined;
  stores.routeStore = {
    ...routerActions,
    get params() {
      return routeParams();
    },
  };

  /*
    A case that names its grants is drawn through the host's real bag: what was not granted is
    absent, a write nobody asked for is refused, and a destructive action asks first — answered by
    the case's `confirm`, and recorded as `confirmations`.
  */
  let confirmations: RenderExpect['actions'] = [];
  if (c.grants) {
    const bag = buildTemplateBag(stores, {
      grants: c.grants as CapabilityGroup[],
      gesture: 'enforce',
      onDestructive: (path, args) => {
        confirmations.push({ call: path, args: args.map(encodeValue) });
        return c.confirm ?? false;
      },
    });
    for (const key of Object.keys(stores)) delete stores[key];
    Object.assign(stores, bag);
  }

  // The root publishes its scope; each panel body is a pass of its own that takes it, as a host's is.
  const [rootScope, setRootScope] = createSignal<PassScope>();
  const panelBodies = (panelsOf(template) ?? []).filter((p) => p.node && typeof p.node === 'object');
  const panels = () =>
    panelBodies.map((p) => (
      <x-probe-panel attr:data-id={String(p.id)}>
        {
          (() => {
            const scope = rootScope();
            return scope
              ? RenderSchema({
                  node: p.node as SchemaNode,
                  stores: stores as never,
                  registry: registry as never,
                  scope,
                  context: { panel: { id: String(p.id), inputs: {} } },
                })
              : null;
          }) as unknown as JSX.Element
        }
      </x-probe-panel>
    ));

  const content = () => {
    if (!routes?.length)
      return RenderSchema({
        node: template,
        stores: stores as never,
        registry: registry as never,
        onScope: setRootScope,
      });
    const history = createMemoryHistory();
    if (c.start && c.start !== '/') history.set({ value: c.start, replace: true });
    const Root = (props: { children?: JSX.Element }) => {
      const go = useNavigate();
      navigate = (to) => go(to);
      const read = useParams();
      routeParams = () => ({ ...read }) as Record<string, string>;
      return RenderSchema({
        node: root,
        stores: stores as never,
        registry: registry as never,
        onScope: setRootScope,
        get children() {
          return props.children;
        },
      });
    };
    return (
      <MemoryRouter history={history} root={Root}>
        {buildRoutes(stores as never, routes, '', [], registry as never)}
      </MemoryRouter>
    );
  };
  const mount = () => (
    <>
      {content()}
      {panels()}
    </>
  );

  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  const { container, unmount } = render(() => mount() as JSX.Element);
  const out: RenderExpect[] = [];
  const snapshot = () => {
    const storage: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith('we-local:')) storage[key] = localStorage.getItem(key)!;
    }
    const entry: RenderExpect = { tree: describeChildren(container), actions: calls };
    if (tracksParams) entry.params = Object.fromEntries([...params].sort(([a], [b]) => a.localeCompare(b)));
    if (c.storage || Object.keys(storage).length) entry.storage = storage;
    if (c.grants) entry.confirmations = confirmations;
    out.push(entry);
    calls = [];
    confirmations = [];
  };

  try {
    await settle();
    snapshot();
    for (const step of c.steps ?? []) {
      run(step, container, setters, navigate);
      await settle();
      snapshot();
    }
  } finally {
    unmount();
    stopTracking();
    console.warn = warn;
    console.error = error;
  }
  return out;
}

function run(
  step: RenderStep,
  container: Element,
  setters: Record<string, SetStoreFunction<Record<string, unknown>>>,
  navigate: ((to: string) => void) | undefined,
): void {
  switch (step.op) {
    case 'click':
      target(container, step.target).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      return;
    case 'input': {
      const el = target(container, step.target) as HTMLInputElement;
      el.value = step.value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
      return;
    }
    case 'emit':
      target(container, step.target).dispatchEvent(
        new CustomEvent(step.event, { detail: step.detail, bubbles: true, composed: true }),
      );
      return;
    case 'navigate':
      if (!navigate) throw new Error('navigate step in a case with no routes');
      navigate(step.to);
      return;
    case 'data':
      setters[step.store](step.member, structuredClone(step.value) as never);
      return;
  }
}
