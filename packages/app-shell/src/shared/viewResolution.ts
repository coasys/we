/**
 * Which sections a space has, resolved — as pure functions.
 *
 * Pure for the reason `dockGeometry` is: this is the part with real edge cases and no way to see
 * them in a render. A section list that silently drops an id, loses its order, or hands two views
 * the same segment produces a page that looks fine and navigates wrongly, and the difference between
 * right and wrong is never visible on screen — only in the list.
 *
 * The three inputs are the three layers, and keeping them as arguments rather than reading them from
 * a store is what makes the settings page possible: it answers these questions for spaces the agent
 * is not standing in, so nothing here may reach for "the current space".
 */
import type { ResolvedView, TemplateSchema } from '@we/schema-shared';

/** One section, with both layers' answers — what a settings list renders. */
export interface ViewSetting {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** The community's decision for this space — shared with every member. */
  enabled: boolean;
  /** This agent's decision, here. Private. Positively phrased so a switch binds to it directly. */
  visible: boolean;
  /** Compiled into this build, as opposed to installed. */
  builtIn: boolean;
}

/**
 * Parse a stored JSON id list, or fall back.
 *
 * Three rules, and each exists because of what its opposite would do:
 *
 * - **Unset means "not decided", never "none".** Every space predating views has no value here, so
 *   reading empty as "none" would land as every existing space losing every tab at once.
 * - **Malformed is a corrupt setting, not a decision.** Same fallback, plus a warning — an
 *   unparseable value is a bug somewhere, and answering it with "this space has no sections" hides
 *   the bug behind a plausible-looking empty nav.
 * - **Order is content.** The stored list is the nav order, so it is preserved exactly rather than
 *   sorted or re-derived.
 *
 * Ids naming a view this build does not have are dropped rather than rendered as a dead tab, but
 * **only from the resolved list** — the stored value keeps them. A space configured where the globe
 * ships, opened where it does not, is missing that section and nothing else; open it somewhere the
 * view exists and it is back. Pruning the stored list here would make that one-way.
 */
export function resolveEnabledViews(
  raw: string | undefined,
  known: (id: string) => boolean,
  fallbackOrder: string[],
): string[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === 'string').filter(known);
      }
    } catch {
      console.warn('space.enabledViews is not valid JSON; falling back to the bundled set');
    }
  }
  return fallbackOrder.filter(known);
}

/** Parse a stored JSON id list of exclusions. A malformed one excludes nothing. */
export function parseIdList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Every view that could render here, each with the segment it will always be at.
 *
 * **This, not the enabled list, is what the route table is built from** — and the distinction is the
 * whole reason this function exists separately.
 *
 * Keying the routes on which sections are *switched on* meant that turning one off rebuilt the route
 * table, which remounts the main Router, which takes `TemplateLayout` and therefore the whole shell
 * overlay down with it. A member removing a section from that space's settings page lost their
 * scroll position, any open editor and every piece of in-flight form state — because a switch had
 * been wired, indirectly, to "rebuild the application".
 *
 * Which views *exist* changes when one is installed or uninstalled, which is rare and genuinely
 * structural. Which are switched on changes whenever somebody flicks a switch. Building the table
 * from the first and filtering it with the second means a toggle costs a re-render of a nav strip
 * and nothing else.
 *
 * Segments are assigned over the whole available set in a stable order, so a view's address never
 * depends on what else happens to be enabled — the property that makes a shared link keep working
 * after the community reorganises.
 */
export function routableSections(available: Map<string, TemplateSchema>, order: string[]): ResolvedView[] {
  // Registry order first, then anything installed beyond it, so the dedup below is deterministic.
  const ids = [
    ...order.filter((id) => available.has(id)),
    ...[...available.keys()].filter((id) => !order.includes(id)),
  ];
  const taken = new Set<string>();

  return ids.map((id) => {
    const schema = available.get(id)!;
    /*
      Two views can want the same segment — one installed beside a built-in that already has it, or a
      fork that kept its parent's. First keeps it; the later one falls back to its id, unique by
      construction. Renaming silently beats the alternative: a duplicate path makes the router match
      whichever route it reaches first, so one section would be unreachable with nothing on screen to
      say which, or why.
    */
    let segment = schema.meta?.segment || id;
    if (taken.has(segment)) segment = id;
    taken.add(segment);
    return { id, segment, schema };
  });
}

/**
 * The sections this space actually offers this agent, in the order it wants them.
 *
 * Community layer, minus this agent's hidden ones. Segments come from {@link routableSections}
 * rather than being re-derived, so the nav strip cannot link somewhere the route table has no route
 * for — which is exactly what re-deriving them from a filtered list would eventually produce.
 *
 * Deliberately **not** intersected with an "installed by me" layer the way modules are. A module is
 * a capability an agent chooses to run; a section is part of what the space *is*, and letting a
 * missing personal install remove one would mean two members opening the same URL and one of them
 * getting a 404.
 */
export function activeSections(opts: {
  routable: ResolvedView[];
  enabledRaw: string | undefined;
  hidden: string[];
  fallbackOrder: string[];
}): ResolvedView[] {
  const byId = new Map(opts.routable.map((view) => [view.id, view]));
  const hidden = new Set(opts.hidden);

  return resolveEnabledViews(opts.enabledRaw, (id) => byId.has(id), opts.fallbackOrder)
    .filter((id) => !hidden.has(id))
    .map((id) => byId.get(id)!);
}

/**
 * Every available section with both layers' answers, for one space.
 *
 * Both travel together for the reason the modules list does: "the community turned this off" and
 * "you hid it for yourself" are different situations with different remedies, and a single boolean
 * cannot tell them apart — it would sit in the "off" position for two reasons and offer the same,
 * wrong, fix for both.
 */
export function viewSettings(opts: {
  enabledRaw: string | undefined;
  hidden: string[];
  available: Map<string, TemplateSchema>;
  fallbackOrder: string[];
  isBuiltIn: (id: string) => boolean;
}): ViewSetting[] {
  const enabledOrder = resolveEnabledViews(opts.enabledRaw, (id) => opts.available.has(id), opts.fallbackOrder);
  const enabled = new Set(enabledOrder);
  const hidden = new Set(opts.hidden);

  /*
    The space's own order first, then everything it does not have.

    This used to iterate the available map, which is registry order — so the settings list showed one
    order and the nav showed another, and the two disagreed the moment anybody reordered anything.
    Worse, the list is what a drag reads its result from: reordering against a list that was never
    showing the real order wrote an order nobody had arranged.

    A section the space does not have has no position, so there is nothing to sort it by. Registry
    order is the honest answer for that group, and keeping it separate is what lets the drag zone
    hold only the sections that *have* an order.
  */
  const rest = [...opts.available.keys()].filter((id) => !enabled.has(id));

  return [...enabledOrder, ...rest].map((id) => {
    const schema = opts.available.get(id)!;
    return {
      id,
      name: schema.meta?.name ?? id,
      description: schema.meta?.description ?? '',
      icon: schema.meta?.icon || 'square',
      enabled: enabled.has(id),
      visible: !hidden.has(id),
      builtIn: opts.isBuiltIn(id),
    };
  });
}
