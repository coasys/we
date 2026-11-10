import { WE_PLUMBING_CLASSES } from './extractionCandidates';
import { modelLabel } from './recordDisplay';

/** One class a space has, as a list of the space's DNA names it. */
export interface SpaceClass {
  name: string;
  label: string;
  icon: string;
  /** The class says how a model should read it — it carries an interpretation hint. */
  hinted: boolean;
}

/** The classes from one origin: the space's own models, one namespace, or WE's built-ins. */
export interface SpaceClassGroup {
  key: string;
  label: string;
  classes: SpaceClass[];
}

/**
 * Where a class comes from, read off its target class IRI: the scheme for a namespace of its own
 * (`conv://`, `flux://`), the host as well for a web IRI (`https://schema.org`), where the scheme
 * alone would put every vocabulary on the web in one group. Empty for an IRI with no scheme.
 */
export function classOrigin(iri: string): string {
  const web = /^(https?):\/\/([^/#?]+)/i.exec(iri);
  if (web) return `${web[1].toLowerCase()}://${web[2]}`;
  const scheme = /^([a-z][\w+.-]*):(\/\/)?/i.exec(iri);
  return scheme ? `${scheme[1].toLowerCase()}:${scheme[2] ?? ''}` : '';
}

/**
 * Every class a space has, grouped by where it comes from — the default way a space's DNA is listed.
 *
 * `known` is every model WE can show here (`recordStore.kinds`): the space's own models, which its
 * group names `This space`, and WE's built-ins. `foreign` is every class the space carries that WE did
 * not write (`currentDatasetEntities`), grouped by the namespace of its target class — so a Flux
 * space's classes sit under `flux://` and a conversation vocabulary under `conv://`, none hidden
 * because WE did not make it. WE's own plumbing (`WE_PLUMBING_CLASSES`) is left out wherever its
 * shape came from, and a foreign class already listed under its name is not listed twice.
 *
 * The space's own models come first, then each other origin by name, then WE's built-ins: the space's
 * own DNA is what somebody opening this list came to read, and WE's is the same in every space. In a
 * group, classes that carry an interpretation hint come first, then the rest by name.
 */
export function groupSpaceClasses({
  known,
  foreign,
}: {
  known: readonly { value: string; label: string; icon: string; group: string }[];
  foreign: readonly { name: string; targetClass: string; interpretationHint?: string }[];
}): SpaceClassGroup[] {
  const listed = new Set(known.map((k) => k.value));
  const plumbing = new Set(WE_PLUMBING_CLASSES);
  const own = known.filter((k) => k.group === 'This space');
  const builtIn = known.filter((k) => k.group !== 'This space');

  const origins = new Map<string, Map<string, SpaceClass>>();
  for (const entry of foreign) {
    if (listed.has(entry.name) || plumbing.has(entry.name)) continue;
    const origin = classOrigin(entry.targetClass) || 'other';
    const classes = origins.get(origin) ?? new Map<string, SpaceClass>();
    origins.set(origin, classes);
    const hinted = !!entry.interpretationHint?.trim() || !!classes.get(entry.name)?.hinted;
    classes.set(entry.name, { name: entry.name, label: modelLabel(entry.name), icon: 'cube', hinted });
  }

  const fromKnown = (k: (typeof known)[number]): SpaceClass => ({
    name: k.value,
    label: k.label,
    icon: k.icon,
    hinted: false,
  });
  const ordered = (classes: Iterable<SpaceClass>) =>
    [...classes].sort((a, b) => Number(b.hinted) - Number(a.hinted) || a.name.localeCompare(b.name));

  const groups: SpaceClassGroup[] = [];
  if (own.length) groups.push({ key: 'space', label: 'This space', classes: own.map(fromKnown) });
  // By name, with the classes no namespace could be read for last.
  const byName = [...origins.keys()].sort((a, b) => (a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b)));
  for (const origin of byName)
    groups.push({
      key: origin,
      label: origin === 'other' ? 'Other' : origin,
      classes: ordered(origins.get(origin)!.values()),
    });
  if (builtIn.length) groups.push({ key: 'we', label: 'WE', classes: builtIn.map(fromKnown) });
  return groups;
}
