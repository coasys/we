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
 * shell nodes **position themselves** — `bootScreen` is a full-bleed `$if`, `sidebar` is a
 * `CollapsibleSidebar` carrying its own `position` prop. Wrapping each anchor in a positioned
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
import type { SlotAnchor, SlotContribution } from '@we/module-shared';
import type { SchemaNode } from '@we/schema-shared';
import { bootScreen, consentPrompt, consentSecret, moduleRail, sidebar, templateEditor } from '@we/template-shell';

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
const ANCHOR_ORDER: SlotAnchor[] = ['overlay', 'dock-left', 'dock-right', 'dock-bottom', 'banner'];

const entries = new Map<string, SlotEntry>();

export const slotRegistry = {
  /** Add a contribution. Replaces any entry with the same id, so re-registration is idempotent. */
  register(entry: SlotEntry): void {
    entries.set(entry.id, entry);
  },

  /**
   * Swap the node of an existing entry, keeping its anchor and order. How a seed white-labels host
   * chrome — the mechanism `initializeIntegrations` already used for `bootScreen`.
   */
  replace(id: string, node: SchemaNode): void {
    const existing = entries.get(id);
    if (existing) entries.set(id, { ...existing, node });
  },

  /** Remove a contribution — a module being disabled. */
  remove(id: string): void {
    entries.delete(id);
  },

  get(id: string): SlotEntry | undefined {
    return entries.get(id);
  },

  /**
   * Every contribution, in render order: by anchor, then by declared `order`, then by **id**.
   *
   * The id tiebreak is not cosmetic. Entries come out of a `Map`, so equal-order contributions would
   * otherwise follow registration order — and chrome would silently rearrange depending on which
   * module happened to load first.
   */
  ordered(): SlotEntry[] {
    return [...entries.values()].sort(
      (a, b) =>
        ANCHOR_ORDER.indexOf(a.anchor) - ANCHOR_ORDER.indexOf(b.anchor) ||
        (a.order ?? 0) - (b.order ?? 0) ||
        a.id.localeCompare(b.id),
    );
  },

  /** Just the nodes, ready to compose into the shell schema. */
  nodes(): SchemaNode[] {
    return slotRegistry.ordered().map((entry) => entry.node);
  },
};

/**
 * Host chrome, registered as ordinary entries so there is exactly one mechanism rather than a special
 * case beside a general one. The order values preserve the previous hardcoded sequence.
 */
export function registerCoreSlots(): void {
  slotRegistry.register({ id: 'core:bootScreen', anchor: 'overlay', node: bootScreen, order: 0 });
  // Above the boot screen in DOM order but below it in z-index, which is deliberate: a consent
  // request can arrive while the user is still unlocking, and it must not cover the password field
  // of the very session it needs in order to be answered.
  slotRegistry.register({ id: 'core:consentPrompt', anchor: 'overlay', node: consentPrompt, order: 1 });
  slotRegistry.register({ id: 'core:consentSecret', anchor: 'overlay', node: consentSecret, order: 2 });
  slotRegistry.register({ id: 'core:sidebar', anchor: 'dock-left', node: sidebar, order: 0 });
  slotRegistry.register({ id: 'core:templateEditor', anchor: 'dock-right', node: templateEditor, order: 0 });
  // The one place feature modules are opened from. Core rather than a module contribution, because
  // only the host can stop launchers colliding — see ModuleRail.schema.ts.
  slotRegistry.register({ id: 'core:moduleRail', anchor: 'dock-right', node: moduleRail, order: 10 });
}

registerCoreSlots();
