/**
 * How the app the agent is in shows spaces.
 *
 * The policy belongs to the app, not to a setting: an app that came in a bundle saying "every space
 * ours" renders each space with that bundle's space template, and switching back to WE's own app puts
 * every space back to its own — nothing to undo, because nothing was written. A space template the
 * agent pinned for one space still wins there; this replaces only "follow the space".
 */
export interface AppDisplaySource {
  app?: { id: string };
  display?: { spaces: 'ours' | 'theirs'; template?: string };
}

/** The space template every space renders with in this app, or undefined when spaces keep their own. */
export function appSpaceTemplate(appId: string, sources: readonly AppDisplaySource[]): string | undefined {
  const display = sources.find((source) => source.app?.id === appId)?.display;
  return display?.spaces === 'ours' ? display.template : undefined;
}

/** The template a space opens with when the agent follows it: the app's, if it shows every space its way. */
export function followedTemplateId(
  spaceDefault: string | undefined,
  appTemplate: string | undefined,
): string | undefined {
  return appTemplate ?? spaceDefault;
}
