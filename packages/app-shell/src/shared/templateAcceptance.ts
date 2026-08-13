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
 *   a button that takes the click and does nothing, and a blocked `$store` renders an empty list.
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
 * Semantic validation (does this component exist, does it take this prop) is deliberately *not*
 * run here. It is the expensive half, it runs on every space switch if it runs at all, and its
 * failure mode is mild — an unknown component renders nothing rather than taking the tree down.
 * The editor runs it where it belongs, against the template being written.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { validateStructure } from '@we/schema-shared';

import type { CapabilityGroup, SurfaceReference } from './registries/templateSurface';
import { inspectTemplateSurface, SPACE_TIER } from './registries/templateSurface';

export interface TemplateAcceptance {
  /** The template, if it may be used at all. Null means refused — do not add it to the list. */
  schema: TemplateSchema | null;
  /** Why it was refused, for a log or an install dialog. Empty when accepted. */
  refusals: string[];
  /** Admitted, but these references will resolve to nothing. */
  blocked: SurfaceReference[];
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
    };
  }

  const { blocked } = inspectTemplateSurface(decoded, options.grants ?? SPACE_TIER);
  return { schema: decoded as TemplateSchema, refusals: [], blocked };
}

/** One line per problem, for the console. Separated so a dialog can render the same facts its way. */
export function describeAcceptance(acceptance: TemplateAcceptance, origin: string): string[] {
  const lines = [...acceptance.refusals];
  if (acceptance.blocked.length) {
    const named = acceptance.blocked.map((reference) => reference.path).join(', ');
    lines.push(`Template from ${origin} refers to ${named}, which it is not allowed to use here.`);
  }
  return lines;
}
