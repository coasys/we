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
 * **Settings → Developer**, which appears only in a build that has developer affordances at all.
 * The store holds it as a signal, so throwing it takes effect on the press — that matters because
 * the switch exists to be thrown *back*: the loop is look, compare, restore, and a reload each way
 * makes it not worth doing.
 *
 * `localStorage` is where it persists, for the same reason the fake-peer count uses it: it survives
 * the reloads you do while looking at something, it is per-device rather than per-build, and nobody
 * sets it by accident. Storing only the muted state — the key is *removed* to restore the default —
 * keeps it to two values with no third to interpret.
 *
 * ## What it does not decide
 *
 * Whether the code is in the bundle. That is a separate problem with a separate answer (a dynamic
 * `import()` boundary), and conflating the two is how a "production build excludes it" claim gets
 * made about a flag that only ever hid things at runtime. This switch governs *visibility*; a
 * production build is still the ceiling, but the ceiling is enforced here rather than by a bundler.
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

/**
 * Remember the choice, so it survives a reload.
 *
 * Written by a control rather than typed into a console, which is the same rule the fake-peer count
 * already states: "the buttons write it; nobody has to type it". An incantation you have to
 * remember is a switch you will leave in the wrong position.
 *
 * Removes the key rather than storing `on`, so the stored states are "muted" and "nothing" — there
 * is no third value to interpret, and a default that changes later applies to everyone who never
 * expressed a preference.
 */
export function setDevToolsMuted(mute: boolean): void {
  try {
    if (mute) globalThis.localStorage?.setItem(DEV_TOOLS_KEY, OFF);
    else globalThis.localStorage?.removeItem(DEV_TOOLS_KEY);
  } catch {
    // Storage that refuses writes is the same class of thing as storage that refuses reads: the
    // preference simply does not persist. The signal in the store still flips for this session.
  }
}
