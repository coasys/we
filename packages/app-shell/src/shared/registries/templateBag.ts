/**
 * The store bag a *template's* nodes render against, lent to whatever renders one out of place.
 *
 * ## Why anything needs this
 *
 * What a node may name is decided by **who wrote it**, not by where it happens to render. Chrome is
 * authored in this repo and gets chrome grants; a template arrives from a stranger and gets the
 * space tier. `TemplateProvider` builds both bags and picks one per render site — which works while
 * every site renders one author's work.
 *
 * A **template panel** is not such a site. Its frame is chrome — the grip, the snap menu and the
 * reset all name `host-layout` members a template must never have — and its *contents* are the
 * template's. One tree, two authors. Rendered whole through the chrome bag, as it was, a template's
 * panel node could name `runtimeStore`, `editorStore` and every other chrome-only member: a
 * capability escalation through `meta.panels`, reached by declaring a panel rather than by being
 * granted anything.
 *
 * So the frame stays chrome and the body renders through this — the template's own bag, lent by the
 * provider that builds it. `RenderSchema` already takes a bag per call site; this is how a component
 * inside one tree reaches a different one.
 *
 * A module-scoped lender rather than a context, for the same reason `hostDockStores` is one: the
 * consumer is reached through the slot registry, which is not a descendant of anything.
 */
import type { Stores } from '@solid/types';

let lent: Stores | null = null;

/** Publish the bag. Returns the take-back, which the provider calls on unmount. */
export function provideTemplateBag(bag: Stores): () => void {
  lent = bag;
  return () => {
    if (lent === bag) lent = null;
  };
}

/**
 * The bag, or `null` before a template is mounted.
 *
 * Null is not a reason to fall back to the chrome bag. A panel body with nowhere to render is a
 * panel that draws nothing for a frame; a panel body rendered with chrome grants is the hole this
 * file exists to close, and it would open exactly when the ordering is unlucky.
 */
export function templateBag(): Stores | null {
  return lent;
}
