/**
 * Which theme an agent sees in a space.
 *
 * A pure function rather than logic inside `SpaceStore`, because the precedence is the whole
 * feature and it is subtle enough to have been designed wrong once: everything else in the store is
 * plumbing that reads a signal and calls a setter, while this is a rule about whose decision beats
 * whose. Extracted so it can be stated, argued with, and tested without a Solid context.
 *
 * ## Precedence turns on *who chose the template*, not on layer
 *
 * The obvious chain — my pin, then the space's theme, then the template's suggestion — is wrong in
 * exactly the case that matters most. A space's default theme was chosen **alongside its default
 * template**; the two are a pair. Rank the theme above the suggestion unconditionally and any space
 * that bothered to set one would never show a template's theme at all: overriding the template to
 * Channels would leave you in the palette somebody picked for the Cards layout.
 *
 * So a theme decision applies while the template it was made beside is the one in use:
 *
 * 1. **An explicit pin always wins.** The agent's own direct act at this exact scope, and the only
 *    way to say "this theme here, whatever else changes". It follows that pinning a theme in a
 *    space stops template switching from moving it *there* — which is what a pin is for, and the
 *    escape hatch from everything below.
 * 2. **`AGENT_DEFAULT` is also explicit** — a choice to follow one's own global default — so a
 *    template does not get to reinterpret it.
 * 3. **The space chose the template** → the space's theme, then the template's suggestion, then the
 *    agent's global default.
 * 4. **The agent chose the template** (their global default, or one pinned here) → the suggestion
 *    first, since the space's theme is now a leftover from an interface they just replaced. The
 *    space's theme still backs it up, so a community's look survives a template with no opinion.
 *
 * None of this is stored. Resolving rather than writing is what makes template switching
 * non-destructive: switching away and back restores the previous look by recomputation, and no
 * stored choice is touched on the way. It is also what makes the opt-out one boolean here rather
 * than a migration.
 */

/** Everything the rule needs. Plain values — the store reads the signals and passes them in. */
export interface ThemeResolutionInput {
  /**
   * `SpacePreference.themeId`: a concrete id (a pin), `AGENT_DEFAULT`, or `FOLLOW_SPACE`.
   * Anything falsy is read as `FOLLOW_SPACE`, since that is what a record predating the field means.
   */
  themeOverride: string;
  /** `SpacePreference.templateId`, read only to tell who chose the template. */
  templateOverride: string;
  /** `Space.defaultThemeId` — what the community set, if anything. */
  spaceTheme: string;
  /**
   * The `meta.themeId` of whichever template actually applies, already checked to be a theme this
   * agent has. Empty when the template suggests nothing, the suggestion names a theme they do not
   * have, or `useTemplateTheme` is off — the caller collapses all three, because the rule below
   * treats them identically.
   */
  templateTheme: string;
  /** `AgentSettings.defaultThemeId` — the agent's global fallback. */
  agentTheme: string;
  /** The sentinel meaning "follow my own global default". */
  agentDefaultSentinel: string;
  /** The sentinel meaning "follow whatever the community set". */
  followSpaceSentinel: string;
}

export function resolveSpaceTheme(input: ThemeResolutionInput): string {
  const { themeOverride, templateOverride, spaceTheme, templateTheme, agentTheme } = input;
  const { agentDefaultSentinel, followSpaceSentinel } = input;

  // A concrete id is a pin. Nothing outranks it.
  if (themeOverride && themeOverride !== agentDefaultSentinel && themeOverride !== followSpaceSentinel) {
    return themeOverride;
  }

  // "Follow my global default" is a decision too, not an absence of one.
  if (themeOverride === agentDefaultSentinel) return agentTheme;

  // Falsy reads as follow-the-space, matching `SpacePreference`'s own convention.
  const spaceChoseTemplate = !templateOverride || templateOverride === followSpaceSentinel;

  return spaceChoseTemplate ? spaceTheme || templateTheme || agentTheme : templateTheme || spaceTheme || agentTheme;
}
