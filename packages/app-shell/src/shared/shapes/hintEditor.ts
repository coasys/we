/**
 * What the hint editor shows for one hint — the rule for reading stored state against a declaration.
 *
 * Pure and framework-free, like the rest of `shared/shapes`, because the decision is subtle enough
 * to be worth stating once and testing directly rather than inferring from a store.
 */

/**
 * The hint to display, given what the space stores and what the model declares.
 *
 * The hard case is an **absent** stored hint, which storage cannot tell apart from a deliberate one:
 * `writeInterpretationHints` removes the link for an empty hint rather than storing a blank, so a
 * hint a community cleared on purpose and a hint nobody ever touched look identical by the time they
 * are read back.
 *
 * The customized marker is what separates them, and is exactly what it exists for:
 *
 * - **Not customized** — nothing here is the community's doing, so an absent hint means the space
 *   never had one and the declaration is what applies. Showing it is showing the truth.
 * - **Customized** — the space owns this entity's interpretation, so an absent hint is a hint
 *   somebody deleted. Falling back to the declaration would put their deleted words back in front of
 *   them, and re-saving would silently reinstate them.
 *
 * Getting this wrong in one direction was visible immediately: property hints read
 * `stored ? (propHints[predicate] ?? '') : declared`, which reached for the declaration only when
 * *nothing at all* was stored — so every saved model opened its editor with every property blank,
 * while the class hint (whose fallback was written the other way) showed correctly.
 */
export function hintToDisplay(args: {
  /** What the space stores for this hint, or undefined when it stores none. */
  stored: string | undefined;
  /** What the model declares — the reset baseline. */
  declared: string;
  /** Whether the space has taken ownership of this entity's hints. */
  customized: boolean;
}): string {
  const { stored, declared, customized } = args;
  if (customized) return stored ?? '';
  return stored ?? declared;
}
