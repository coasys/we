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

/** What stands in a missing part's place says this: why it is not here, in a sentence. */
export function describeMissing(why: MissingPart, facts: { moduleName: string; canAdminister: boolean }): string {
  switch (why) {
    case 'not-in-build':
      return `It comes from ${facts.moduleName}, which this app does not include.`;
    case 'no-such-part':
      return `${facts.moduleName} no longer offers this piece.`;
    case 'off-for-you':
      return `You have turned ${facts.moduleName} off.`;
    case 'off-in-space':
      return facts.canAdminister
        ? `${facts.moduleName} is turned off in this space.`
        : `${facts.moduleName} is turned off in this space. Whoever runs the space can turn it on.`;
    case 'hidden-here':
      return `You have hidden ${facts.moduleName} in this space.`;
  }
}

/** Where turning a missing part's module back on lives, when the person looking can. */
export function fixFor(
  why: MissingPart,
  deps: {
    canAdminister: boolean;
    datasetId?: string;
    openShellView: (id: string, path?: string) => void;
    openSpaceSettings: (tab?: string) => void;
  },
): { label: string; go: () => void } | null {
  switch (why) {
    case 'off-for-you':
      return { label: 'Turn it on', go: () => deps.openShellView('settings', '/modules') };
    case 'off-in-space':
      return deps.canAdminister ? { label: 'Space features', go: () => deps.openSpaceSettings('features') } : null;
    case 'hidden-here':
      return deps.datasetId
        ? { label: 'Show it here', go: () => deps.openShellView('settings', `/spaces/${deps.datasetId}`) }
        : null;
    default:
      return null;
  }
}
