/**
 * The shape of a capability profile: a named, versioned contract for the host state and actions a
 * template reaches beyond records, queries and declared operations.
 *
 * Plain JSON on purpose. The profiles are what a second host implements, in whatever language it is
 * written in, so their definitions are data a generator can print as a language-neutral listing
 * (`docs/spec/profiles/`) rather than TypeScript another host would have to read.
 */

/** One argument an action takes, in order. */
export interface ProfileArg {
  name: string;
  /** The value's shape, written as a type expression: `string`, `boolean`, `{ push?: boolean }`. */
  type: string;
  optional?: boolean;
}

export interface ProfileMember {
  /**
   * The name a template writes: the profile's namespace and the member, as in
   * `{ $: 'navigation.params.id' }` or `{ $invoke: 'navigation.navigate' }`. A name in the bag, and
   * nothing more: which of the host's own stores holds the value behind it is the host's business,
   * and a host may move it between them without a template noticing.
   */
  path: string;
  /** `state` is read in expressions; `action` is called through `$invoke`. */
  kind: 'state' | 'action';
  /**
   * The capability group that grants it. A profile says what a host provides; the group still says
   * whether a given template may have it, exactly as for a member outside every profile.
   */
  group: string;
  /** State: what the value is, as a type expression. */
  shape?: string;
  /** Action: its arguments. A template-tier call passes only these; anything beyond is dropped. */
  args?: ProfileArg[];
  /** State: what it holds. Action: what it does. */
  description: string;
  /** Action: safe to run with nobody asking — it changes only what this person is looking at. */
  ambient?: boolean;
  /** The change events that announce this state changing, or that this action may cause. */
  events: string[];
}

/** A change a template can observe: the state members that move together when it happens. */
export interface ProfileEvent {
  name: string;
  /** The state members whose values this event changes. */
  changes: string[];
  description: string;
}

export interface CapabilityProfile {
  /** `navigation`, `view-state`, … — stable, and what `meta.requires` will name. */
  id: string;
  /**
   * The name its members are written under, in camelCase: `viewState.openPanel`, `spaceSettings.currentSpace`.
   * A template names a profile member by this and never by the store that implements it, so the name
   * alone says that the member travels to any host providing the profile.
   */
  namespace: string;
  /**
   * Semantic version. `0.x` while WE is the only host providing the profile: a draft, changed in
   * place with the minor raised. It freezes at `1.0.0` once a second host passes its vectors, and
   * from then minor only adds optional members, events or arguments, and removing, renaming or
   * retyping one is a new major. See `docs/spec/profiles/README.md`, "Versioning".
   */
  version: string;
  title: string;
  description: string;
  members: ProfileMember[];
  events: ProfileEvent[];
}
