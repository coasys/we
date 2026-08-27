/**
 * Slot Registry — persistent shell chrome, from the host and from feature modules.
 *
 * Generalises the former fixed `shellRegistry` (three named keys, typed `typeof shellRegistry`) into
 * an open collection, because a module has to be able to **add** chrome rather than override one of
 * three. A call bar, a notifications tray, a mini-player and an offline banner all want the same
 * thing.
 *
 * ## Anchors order and group; they do not position
 *
 * Deliberate, and it is what makes this a faithful generalisation rather than a rewrite. WE's existing
 * shell nodes **position themselves** — `bootScreen` is a full-bleed `$if`, `sidebar` is a rail
 * (`railShell`) carrying its own `position` prop. Wrapping each anchor in a positioned
 * container would change how all three render.
 *
 * So an anchor is semantic metadata: it groups contributions and fixes their order in the flat output.
 * The node still positions itself, exactly as before. A future anchor could emit a container, but that
 * would be a behaviour change and needs to be made deliberately, not smuggled in here.
 *
 * ## Templates cannot reach this
 *
 * Shell chrome is app-lifetime and cross-space; a template is per-space. "This template hides the call
 * bar" is incoherent the moment you navigate — you are in a call hosted in space B while viewing space
 * A. `TemplateProvider` renders the shell outside the keyed Router precisely so it survives template
 * switches. Configuration belongs to the seed (deployment), an agent preference (per-user), and the
 * module's own state — chrome that is only present when relevant needs no hiding mechanism at all.
 */
import type { CoreSlotAnchor, SlotAnchor, SlotContribution } from '@we/module-shared';
import type { SchemaNode } from '@we/schema-shared';
import {
  bootScreen,
  chromeRail,
  consentPrompt,
  consentSecret,
  createSpaceModalMount,
  namePrompt,
  removeAccountModal,
  sidebar,
  templateEditor,
} from '@we/template-shell';

import { byOrderThenId, createRegistry } from './createRegistry';
import { registerEditorDocks } from './editorDocks';
import { registerShellDocks } from './shellDocks';

export interface SlotEntry extends SlotContribution {
  /** Unique. `core:*` for host chrome, otherwise the contributing module's id. */
  id: string;
}

/**
 * Anchor precedence in the flat output.
 *
 * `overlay` first is not a design statement — it is what preserves today's
 * `[bootScreen, sidebar, templateEditor]` ordering exactly. Changing it is a visual change.
 */
const ANCHOR_ORDER: CoreSlotAnchor[] = ['overlay', 'dock-left', 'dock-right', 'dock-bottom', 'banner'];

const isCoreAnchor = (anchor: SlotAnchor): anchor is CoreSlotAnchor => (ANCHOR_ORDER as string[]).includes(anchor);

/**
 * Registration is observable, because chrome no longer all arrives before the first render.
 *
 * Modules register at boot, so `nodes()` read once was enough for years. A template declaring panels
 * does not: its frames are registered reactively when a template says it has them, which is after
 * the shell has been built. Without a channel to say so they were registered into a list nobody read
 * again — the dock resolved geometry for a panel that never mounted, which looks exactly like the
 * panel being broken rather than absent.
 *
 * The channel is `createRegistry`'s, shared with every other registry; it was a second hand-rolled
 * copy of `dockRegistry`'s before that existed.
 */
const registry = createRegistry<SlotEntry>();

/**
 * Splice module-declared anchors into a node tree.
 *
 * A `{ type: '$slot', props: { anchor } }` marker is replaced by whatever is contributed there, in
 * order. Resolved here rather than in the renderer because the host is already the thing that
 * composes chrome into a schema — `TemplateProvider` builds the shell from `nodes()` — so this is one
 * more step of the same composition rather than a new capability every renderer would have to learn.
 *
 * Recursive, because the marker sits wherever the providing module put it: the call module's is deep
 * inside its control bar's `Row`, not at the top of its contribution.
 *
 * An anchor with nothing in it resolves to nothing. That is the ordinary case — the transcribe module
 * is not installed, so the call bar simply has one fewer button — and it is why the marker must
 * disappear rather than render an empty container that would leave a gap in the row.
 */
function resolveAnchors(node: SchemaNode): SchemaNode | SchemaNode[] {
  if (node.type === '$slot') {
    const anchor = (node.props as { anchor?: string } | undefined)?.anchor;
    if (!anchor) return [];
    return slotRegistry.nodesFor(anchor);
  }

  const nextChildren = resolveList(node.children);
  const nextProps = resolveValue(node.props);
  const nextSlots = resolveValue(node.slots);

  if (nextChildren === node.children && nextProps === node.props && nextSlots === node.slots) return node;
  return { ...node, children: nextChildren, props: nextProps, slots: nextSlots } as SchemaNode;
}

/** Anything node-shaped. Token objects (`{ $: … }`) have no `type`, so they fall through here. */
const isNode = (value: unknown): value is SchemaNode =>
  !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';

/**
 * Walk a children array, flattening the arrays a resolved marker expands into.
 *
 * Returns the original reference when nothing changed, so an untouched subtree keeps its identity and
 * the renderer has no reason to remount it.
 */
function resolveList(children: unknown): unknown {
  if (!Array.isArray(children)) return children;

  let changed = false;
  const out: unknown[] = [];
  for (const child of children) {
    if (!isNode(child)) {
      out.push(child);
      continue;
    }
    const next = resolveAnchors(child);
    if (Array.isArray(next)) {
      changed = true;
      out.push(...next);
    } else {
      if (next !== child) changed = true;
      out.push(next);
    }
  }
  return changed ? out : children;
}

/**
 * Walk anywhere a node can hide, not just `children`.
 *
 * Necessary rather than thorough: the registry wraps every module contribution in a per-space `$if`,
 * whose real content is `props.then` — so a walk that only followed `children` never reached the
 * chrome it was meant to be resolving, and markers came out untouched. Module chrome nests the same
 * way of its own accord (the call bar is an `$if` before it is a `Row`), and named `slots` hold nodes
 * too.
 */
function resolveValue(value: unknown): unknown {
  if (Array.isArray(value)) return resolveList(value);
  if (isNode(value)) {
    const next = resolveAnchors(value);
    // A marker in a node-valued *prop* has nowhere to expand to — `props.then` is one node, not a
    // list — so several contributions there would have to be dropped. Nothing does this today; the
    // warning is here so that if something ever does, it says so rather than silently losing chrome.
    if (Array.isArray(next)) {
      if (next.length > 1) {
        console.warn('slotRegistry: $slot in a node-valued prop resolved to several nodes; keeping the first');
      }
      return next[0];
    }
    return next;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      const next = resolveValue(inner);
      if (next !== inner) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  }
  return value;
}

/** Subscribe to contribution changes. Returns an unsubscribe. */
export const onSlotRegistryChanged = registry.subscribe;

export const slotRegistry = {
  /** Add a contribution. Replaces any entry with the same id, so re-registration is idempotent. */
  register: registry.register,

  /**
   * Swap the node of an existing entry, keeping its anchor and order. How a seed white-labels host
   * chrome — the mechanism `initializeIntegrations` already used for `bootScreen`.
   */
  replace(id: string, node: SchemaNode): void {
    const existing = registry.get(id);
    if (!existing) return;
    registry.register({ ...existing, node });
  },

  /** Remove a contribution — a module being disabled. */
  remove(id: string): void {
    registry.remove(id);
  },

  get: registry.get,

  /**
   * Every contribution, in render order: by anchor, then by declared `order`, then by id — the
   * registry's own ordering, with the anchor's rank in front of it.
   */
  ordered(): SlotEntry[] {
    return registry
      .ordered()
      .filter((entry) => isCoreAnchor(entry.anchor))
      .sort(
        (a, b) =>
          ANCHOR_ORDER.indexOf(a.anchor as CoreSlotAnchor) - ANCHOR_ORDER.indexOf(b.anchor as CoreSlotAnchor) ||
          byOrderThenId(a, b),
      );
  },

  /**
   * Contributions to a module-declared anchor, in order — what a `$slot` marker resolves to.
   *
   * Kept out of {@link ordered}, which is the shell's own top level. Without that filter a
   * contribution to an unknown anchor would sort to index -1 and render at the top of the app,
   * loose, instead of inside the bar it was meant for.
   */
  nodesFor(anchor: string): SchemaNode[] {
    return registry
      .ordered()
      .filter((entry) => entry.anchor === anchor)
      .map((entry) => entry.node);
  },

  /**
   * Every entry, whatever its anchor.
   *
   * Distinct from {@link ordered}, which is the shell's top level and therefore core anchors only.
   * Anything that needs to see *all* contributions — clearing the registry, auditing it — wants this.
   */
  all: registry.all,

  /** Every anchor something has been contributed to, for reporting one nobody provides. */
  contributedAnchors(): string[] {
    return [...new Set(registry.all().map((entry) => entry.anchor))].filter((a) => !isCoreAnchor(a));
  },

  /** Just the nodes, ready to compose into the shell schema, with `$slot` markers filled in. */
  nodes(): SchemaNode[] {
    return slotRegistry.ordered().flatMap((entry) => {
      const resolved = resolveAnchors(entry.node);
      return Array.isArray(resolved) ? resolved : [resolved];
    });
  },
};

/**
 * Host chrome, registered as ordinary entries so there is exactly one mechanism rather than a special
 * case beside a general one. The order values preserve the previous hardcoded sequence.
 *
 * **Called by `initializeIntegrations`, not by importing this file.** It used to run at module scope,
 * one line below the body, which is a side effect inside an import cycle: this file imports
 * `registerEditorDocks` and `editorDocks.ts` imports this one, so whichever is entered second is only
 * half-initialised when the call fires. Reached from here it worked every time, for as long as
 * nothing imported `editorDocks` first — and the moment something did, it threw `Cannot access
 * 'PANELS' before initialization` from a file neither of them mentions. See `editorDocks.test.ts`.
 *
 * Explicit is also honest about what was already true: `initializeIntegrations` replaces
 * `core:bootScreen` from the seed, which only works once these are registered, so the ordering was a
 * real requirement met by accident of import order rather than by anybody arranging it.
 *
 * Idempotent — both registries key on id — so a second call re-registers rather than duplicating,
 * which is what the tests rely on after clearing.
 */
export function registerCoreSlots(): void {
  slotRegistry.register({ id: 'core:bootScreen', anchor: 'overlay', node: bootScreen, order: 0 });
  // Above the boot screen in DOM order but below it in z-index, which is deliberate: a consent
  // request can arrive while the user is still unlocking, and it must not cover the password field
  // of the very session it needs in order to be answered.
  slotRegistry.register({ id: 'core:consentPrompt', anchor: 'overlay', node: consentPrompt, order: 1 });
  slotRegistry.register({ id: 'core:consentSecret', anchor: 'overlay', node: consentSecret, order: 2 });
  // Chrome rather than part of the settings page: it is a modal over whatever is behind it, and
  // the settings page is itself an overlay.
  slotRegistry.register({ id: 'core:removeAccount', anchor: 'overlay', node: removeAccountModal, order: 3 });
  // Chrome for the same reason, plus one of its own: it is opened from two places — the settings
  // page and the sidebar's spaces group — so it cannot belong to either. See `shellStore.createSpaceOpen`.
  slotRegistry.register({ id: 'core:createSpace', anchor: 'overlay', node: createSpaceModalMount, order: 4 });
  // Last of the overlays, and deliberately: it is the only one raised by the app rather than by
  // something the user just did, so anything they *did* ask for belongs in front of it. Its own gate
  // (`profileStore.needsName`) is false until the app is ready and the profile fetch has answered,
  // so it cannot appear over the boot screen either. See NamePrompt.schema.ts.
  slotRegistry.register({ id: 'core:namePrompt', anchor: 'overlay', node: namePrompt, order: 5 });
  slotRegistry.register({ id: 'core:sidebar', anchor: 'dock-left', node: sidebar, order: 0 });
  slotRegistry.register({ id: 'core:templateEditor', anchor: 'dock-right', node: templateEditor, order: 0 });
  // The editor's panels, as docks — see `editorDocks.ts` for why they are not part of the node above.
  registerEditorDocks();
  // The shell's own — a space's settings, which the chrome rail's gear opens. See `shellDocks.ts`.
  registerShellDocks();
  // The one place feature modules are opened from. Core rather than a module contribution, because
  // only the host can stop launchers colliding — see ChromeRail.schema.ts.
  slotRegistry.register({ id: 'core:chromeRail', anchor: 'dock-right', node: chromeRail, order: 10 });
}
