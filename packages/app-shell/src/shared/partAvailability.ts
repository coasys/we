/**
 * Whether a placed part can draw here, and if not, why — which decides what is offered in its place.
 *
 * One answer for everything that has to say it: the stand-in a template shows where the part should
 * be, and the inspector when the part is selected. Two places reasoning about this separately would
 * sooner or later give somebody two different reasons for one hole.
 *
 * Asked in order, because the order is what makes each reason true. "Turned off in this space" is
 * only the reason once it is settled that the person has not turned the module off everywhere — they
 * would turn it on in the space and still not see it.
 */

/** Why a part cannot draw here. */
export type MissingPart = 'not-in-build' | 'no-such-part' | 'off-for-you' | 'off-in-space' | 'hidden-here';

export interface PartFacts {
  /** This build includes the module at all. */
  registered: boolean;
  /** The module still publishes a part by this name. */
  published: boolean;
  /** A space is on screen. Outside one no community has decided anything, so only the build counts. */
  inSpace: boolean;
  /** The module draws here for this person: installed, enabled by the space, not hidden here. */
  active: boolean;
  /** This person has the module on everywhere. */
  installed: boolean;
  /** The space has the module on. */
  enabled: boolean;
}

export function whyMissing(facts: PartFacts): MissingPart | null {
  if (!facts.registered) return 'not-in-build';
  if (!facts.published) return 'no-such-part';
  if (!facts.inSpace || facts.active) return null;
  if (!facts.installed) return 'off-for-you';
  if (!facts.enabled) return 'off-in-space';
  return 'hidden-here';
}
