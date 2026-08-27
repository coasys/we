/**
 * Whether developer affordances are on — and the one switch that turns them off.
 *
 * Two different questions live behind "is this a development build", and conflating them is why
 * this exists as its own thing. **Is this a dev build** is a fact about how the app was compiled;
 * `sessionStore.isDevelopment` answers that and should keep answering only that. **Should developer
 * affordances be visible** is a question a developer is allowed to have an opinion about — and the
 * opinion they want is usually "not right now, I am looking at what a user sees".
 *
 * So: dev affordances are on in a dev build, unless the switch below is set. Nothing turns them on
 * in a production build; the build is still the ceiling.
 *
 * ## The switch
 *
 * ```js
 * localStorage.setItem('we.devTools', 'off');   // reload: the app looks shipped
 * localStorage.removeItem('we.devTools');       // reload: the tools are back
 * ```
 *
 * `localStorage` for the same reason the fake-peer count uses it: it survives the reloads you do
 * while looking at something, it is per-device rather than per-build, and nobody sets it by
 * accident. A key that must be *removed* to restore the default is deliberate too — an affordance
 * you hid on purpose should not quietly return because a signal changed.
 *
 * ## Why it is read once
 *
 * Every consumer reads this at start-up: the call module decides at *definition* time whether its
 * controls exist at all, so nothing it does can be reactive to a later change. A store value that
 * updated live while the module's half did not would be one switch with two answers. Set it, reload,
 * and the whole app agrees.
 */

/** The key a developer sets. Named once here; both the shell and the call module read it. */
export const DEV_TOOLS_KEY = 'we.devTools';

/** The value that means off. Anything else — including absent — leaves the tools on. */
const OFF = 'off';

/**
 * Read the switch.
 *
 * Wrapped in a `try` because `localStorage` is not merely absent in some contexts, it *throws*:
 * a browser set to block site data, or a document rendered somewhere without an origin. The honest
 * fallback is "not muted", which lands on whatever `isDevBuild` already said.
 */
function muted(): boolean {
  try {
    return globalThis.localStorage?.getItem(DEV_TOOLS_KEY) === OFF;
  } catch {
    return false;
  }
}

/**
 * Whether to show developer affordances, given what kind of build this is.
 *
 * Takes the build flag rather than reading it, because the two callers get it from different places
 * — the shell from its platform adapter, the call module from `import.meta.env` — and a module must
 * not take a build tool as a dependency to answer a question the host already knows the answer to.
 */
export function devToolsEnabled(isDevBuild: boolean): boolean {
  return isDevBuild && !muted();
}
