/**
 * The gate every template passes through on its way in.
 *
 * ## Why an ingest check exists at all
 *
 * A template is data, and WE's whole argument is that data is safe to accept from strangers. That
 * argument only holds where something checks. Two things arrive unchecked today:
 *
 * - **A malformed schema.** `loadSpaceTemplates` decodes a `Template` model's JSON and pushes it
 *   straight into `allTemplates`. A node whose `children` is a string, or whose `props` is an
 *   array, throws inside the renderer — and a throw during render in Solid takes down the tree it
 *   is in, so a space you merely *visited* blanks the app. Nobody had to install anything: the
 *   template synced in with the space.
 * - **A schema reaching past its tier.** `buildTemplateBag` already refuses those references, so
 *   this is not what stops them. What it stops is their *invisibility*: a blocked `$action` renders
 *   a button that takes the click and does nothing, and a blocked store read renders an empty list.
 *   A template that is quietly half-broken looks exactly like a template that is fine.
 *
 * ## Refuse, or admit and complain
 *
 * Structural failure is a refusal: there is no rendering of a broken tree that is better than not
 * rendering it, and the alternative is the blank app above.
 *
 * A reference outside the tier is not. Refusing the whole template because one button asked for
 * something it may not have would throw away the ninety-nine that were fine, and the reference is
 * already inert. So it is admitted and reported — which is the first time anybody could have known.
 *
 * An element a template may not mount (`script`, an `iframe`) is the same case: the renderer
 * already draws nothing for it, so it is admitted and reported, with the elements named. A template
 * carrying one is either confused or hostile, and either way the person installing it should hear.
 *
 * Semantic validation (does this component exist, does it take this prop) is deliberately *not*
 * run here. It is the expensive half, it runs on every space switch if it runs at all, and its
 * failure mode is mild — an unknown component renders nothing rather than taking the tree down.
 * The editor runs it where it belongs, against the template being written.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { isTemplateElement, validateStructure } from '@we/schema-shared';

import type { CapabilityGroup, SurfaceReference } from './registries/templateSurface';
import { CAPABILITY_GROUPS, inspectTemplateSurface, SPACE_TIER } from './registries/templateSurface';

export interface TemplateAcceptance {
  /** The template, if it may be used at all. Null means refused — do not add it to the list. */
  schema: TemplateSchema | null;
  /** Why it was refused, for a log or an install dialog. Empty when accepted. */
  refusals: string[];
  /** Admitted, but these references will resolve to nothing. */
  blocked: SurfaceReference[];
  /**
   * The capability groups the template actually uses, for an install dialog to show.
   *
   * `inspectTemplateSurface` has computed this since it was written and the one production caller
   * dropped it on the floor, which is why nothing could ever say what a template was asking for.
   * Carried through here so the answer reaches the only place it matters — the moment somebody
   * decides whether to install.
   */
  groups: CapabilityGroup[];
  /** Native elements it names that a template may not mount, each once. They will render nothing. */
  refusedElements: string[];
}

export interface AcceptTemplateOptions {
  /** Where it came from, for the message. e.g. `space "Gardening"`, `the marketplace`. */
  origin: string;
  /** The tier it will render at. Defaults to `SPACE_TIER` — the safe answer for anything synced. */
  grants?: readonly CapabilityGroup[];
}

/**
 * Judge a decoded template.
 *
 * Takes `unknown` rather than `TemplateSchema` on purpose: the value has just come out of JSON
 * somebody else wrote, and typing the parameter as the thing it is being checked for would be the
 * assumption this function exists to stop making.
 */
export function acceptTemplate(decoded: unknown, options: AcceptTemplateOptions): TemplateAcceptance {
  const structural = validateStructure(decoded);
  if (!structural.valid) {
    const detail = structural.errors
      .filter((error) => error.severity === 'error')
      .slice(0, 5)
      .map((error) => `${error.path}: ${error.message}`);
    return {
      schema: null,
      refusals: [`Template from ${options.origin} is not a valid schema`, ...detail],
      blocked: [],
      groups: [],
      refusedElements: [],
    };
  }

  const { blocked, groups } = inspectTemplateSurface(decoded, options.grants ?? SPACE_TIER);
  return {
    schema: decoded as TemplateSchema,
    refusals: [],
    blocked,
    groups,
    refusedElements: refusedElements(decoded),
  };
}

/**
 * Lowercase node types outside the allowlist, found anywhere in the tree.
 *
 * Walks every object rather than one walker's idea of a child, so a node held in `$defs`, a panel or
 * a prop is found too. A thing counts as a node when it has a string `type` and `props` or
 * `children` beside it — the shape the renderer mounts. Reporting, not enforcement: the renderer is
 * what refuses, so a node this misses is still drawn as nothing.
 */
function refusedElements(schema: unknown): string[] {
  const found = new Set<string>();
  const seen = new WeakSet<object>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach(walk);
    const node = value as Record<string, unknown>;
    const type = node.type;
    if (
      typeof type === 'string' &&
      ('props' in node || 'children' in node) &&
      /^[a-z][a-z0-9]*$/.test(type) &&
      !isTemplateElement(type)
    ) {
      found.add(type);
    }
    Object.values(node).forEach(walk);
  };
  walk(schema);
  return [...found].sort();
}

/**
 * What a template is asking for, in the words a person reads at install time.
 *
 * The group descriptions are already written for a human — that is what `CAPABILITY_GROUPS` is —
 * so this is only the join. Sorted so two installs of the same template read the same way rather
 * than in whatever order the walk happened to find them.
 */
export function describeCapabilities(groups: readonly CapabilityGroup[]): string[] {
  return [...groups]
    .sort()
    .map((group) => CAPABILITY_GROUPS[group])
    .filter(Boolean);
}

/** One line per problem, for the console. Separated so a dialog can render the same facts its way. */
export function describeAcceptance(acceptance: TemplateAcceptance, origin: string): string[] {
  const lines = [...acceptance.refusals];
  if (acceptance.blocked.length) {
    const named = acceptance.blocked.map((reference) => reference.path).join(', ');
    lines.push(`Template from ${origin} refers to ${named}, which it is not allowed to use here.`);
  }
  if (acceptance.refusedElements.length) {
    const tags = acceptance.refusedElements.map((tag) => `<${tag}>`).join(', ');
    lines.push(`Template from ${origin} contains ${tags}, which a template may not use. They will not render.`);
  }
  return lines;
}
