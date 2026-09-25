import type { TemplatePanel } from '@we/schema-shared';

/**
 * Which panels belong on the screen right now — the shell's, the section's, and the route filter.
 *
 * Pure and out here for the reason `recordNavigation.ts` and `dockGeometry.ts` are: two decisions
 * live in it that are invisible when they go wrong. A section's panel silently outranking the
 * shell's would move somebody's furniture in an interface that never asked for it, and a route
 * filter that dropped a panel it should have kept *unregisters* the dock — throwing away its scroll
 * position, its subscriptions and wherever it had been dragged, which reads as the panel having
 * been rebuilt rather than as a filter being wrong. Neither needs a store, a router or a browser to
 * decide, so neither should need one to test.
 *
 * @param shell    what the interface declares, in `meta.panels`.
 * @param view     what the section on screen declares, where there is one.
 * @param segments the path, as segments — the same list a route match is made from.
 */
export function activePanels(
  shell: readonly TemplatePanel[],
  view: readonly TemplatePanel[] | undefined,
  segments: readonly string[],
): readonly TemplatePanel[] {
  /*
    The shell wins on a collision of id.

    A section is portable — it renders inside interfaces it knows nothing about — so what it says
    about the screen is a suggestion, and the interface that owns the screen overrules it.
  */
  const merged = (() => {
    if (!view?.length) return shell;
    const overridden = new Set(shell.map((panel) => panel.id));
    return [...view.filter((panel) => !overridden.has(panel.id)), ...shell];
  })();

  /*
    A declaration may scope itself to a route segment, which is how a shell that routes *itself*
    varies its layout — every showcase template does, and has no sections to hang a declaration on.

    One segment or a list of them: "these two pages and not the third" is an ordinary thing to want,
    and the shape people reached for instead — one panel declared twice under two routes — is one
    panel written down twice for the two copies to disagree about later.
  */
  return merged.filter((panel) => {
    if (!panel.route) return true;
    const wanted = Array.isArray(panel.route) ? panel.route : [panel.route];
    return wanted.some((segment) => segments.includes(segment));
  });
}
