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
   * The name a template writes: `<namespace>.<member>`, as in `{ $: 'routeStore.params.id' }` or
   * `{ $invoke: 'routeStore.navigate' }`. A name in the bag, and nothing more: how a host holds the
   * value behind it is the host's own business.
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
   * Semantic version. Minor adds members, events or optional arguments; major removes or renames
   * one, or changes what a value or an argument means.
   */
  version: string;
  title: string;
  description: string;
  members: ProfileMember[];
  events: ProfileEvent[];
}
