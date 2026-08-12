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
 * 3. **The template on screen is the space's default** → the space's theme, then the template's
 *    suggestion, then the agent's global default. The pair the community set holds.
 * 4. **It is anything else** — switched, pinned, or the agent's own global default — → the
 *    suggestion first, since the space's theme is now a leftover from an interface that was
 *    replaced. The space's theme still backs it up, so a community's look survives a template with
 *    no opinion of its own.
 *
 * "Who chose it" is read off *what is rendering* rather than off a preference field, because the
 * switcher and the per-space override write different places. See `templateIsSpaceDefault`.
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
  /**
   * Is the template **actually on screen** the one the space set as its default?
   *
   * Derived from the rendering template rather than from `SpacePreference.templateId`, because
   * there are two ways to change template and only one goes through that field:
   * `spaceStore.setSpaceTemplateOverride` writes the preference, while the template *switcher*
   * calls `templateStore.switchTemplate`, which writes `AgentSettings.currentTemplateId` and never
   * touches it. Reading the preference therefore said "the space chose" while the agent was looking
   * at something they had picked themselves a second ago — and the suggestion never applied.
   *
   * Comparing what is rendering against the space's default answers the question the rule actually
   * asks, and answers it the same way however the template got there.
   */
  templateIsSpaceDefault: boolean;
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
  const { themeOverride, templateIsSpaceDefault, spaceTheme, templateTheme, agentTheme } = input;
  const { agentDefaultSentinel, followSpaceSentinel } = input;

  // A concrete id is a pin. Nothing outranks it.
  if (themeOverride && themeOverride !== agentDefaultSentinel && themeOverride !== followSpaceSentinel) {
    return themeOverride;
  }

  // "Follow my global default" is a decision too, not an absence of one.
  if (themeOverride === agentDefaultSentinel) return agentTheme;

  return templateIsSpaceDefault ? spaceTheme || templateTheme || agentTheme : templateTheme || spaceTheme || agentTheme;
}
