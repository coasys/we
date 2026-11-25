/**
 * How a join is addressed and how long it is waited out — the pure half of `SpaceStore.joinSpace`.
 */

/**
 * The three forms a space can be handed to `SpaceStore.joinSpace` in, reduced to the one they
 * share.
 *
 * A share link is an ordinary URL on the web, the backend's own URI everywhere else (see
 * `SpaceListEntry.shareLink`), and what a join gate reads off the route is the bare id sitting
 * inside both. Nothing can ask "is this the space I am already joining?" — or "is this the space
 * that just arrived?" — until they collapse to one value, because comparing the raw strings makes a
 * link and the id inside it two different spaces.
 *
 * Scheme-agnostic on purpose: each backend spells its own, and this store is not supposed to know
 * which. Any `<scheme>://` prefix that is not the web's own is the backend's, and the id is
 * what follows it.
 */
export function sharedIdOf(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) {
    const scheme = raw.indexOf('://');
    return scheme === -1 ? raw : raw.slice(scheme + 3);
  }
  try {
    const segments = new URL(raw).pathname.split('/').filter(Boolean);
    const marker = segments.indexOf('space');
    return (marker === -1 ? segments[segments.length - 1] : segments[marker + 1]) ?? '';
  } catch {
    return raw;
  }
}

/**
 * What to hand the backend, given what the caller had.
 *
 * Everything but a web URL passes through untouched — the adapter already accepts its own URI or a
 * bare id, and normalizing further would only invent a form it has to undo. A web link is the one
 * shape no backend can read, so it is unwrapped here, where the fact that WE serves spaces at
 * `/space/<id>` is already known.
 */
export const joinTargetOf = (input: string): string =>
  /^https?:\/\//i.test(input.trim()) ? sharedIdOf(input) : input.trim();

/** Does this dataset answer to the id a caller asked to join, in whichever form they had it? */
export function datasetAnswersTo(ds: { id: string; sharedId?: string; sharedUri?: string }, input: string): boolean {
  const target = input.trim();
  const id = sharedIdOf(target);
  return ds.id === target || ds.id === id || ds.sharedId === id || ds.sharedUri === target;
}

/**
 * How long a join keeps looking for a dataset after the call to make it has already failed.
 *
 * Joining is a long-running backend operation wearing a request/response call's clothes: the
 * backend may have to fetch what the shared dataset is and install how it syncs before the dataset
 * exists at all, and only creates it at the very end. The transport can give up well before that on
 * a first join — one backend's client applies one flat 30s timeout to every call it makes — and
 * the resulting 408 says nothing whatsoever about whether the join is still running. It usually is.
 *
 * So a failed call is not a failed join, and the honest response to one is to keep watching for a
 * while. Five minutes is past the point where a join that is going to work has worked, and the
 * backoff keeps a remote host from being asked a hundred times to find out.
 */
export const JOIN_RECOVERY_WINDOW_MS = 5 * 60_000;
export const JOIN_RECOVERY_FIRST_POLL_MS = 2_000;
export const JOIN_RECOVERY_MAX_POLL_MS = 15_000;

/** When a join stops looking instant, so the UI can say so instead of spinning in silence. */
export const JOIN_SLOW_AFTER_MS = 8_000;

/**
 * Did the *call* give up, or did the backend answer?
 *
 * Only the first is worth waiting out. A timeout or a dropped socket says nothing about whether the
 * join is still running, so the question is simply unanswered and worth asking again. Anything else
 * is the backend having looked and told us: a URL that resolves to no space does not become one by
 * being asked about for another five minutes, and treating the two alike would leave someone who
 * pasted a bad link watching a spinner until the recovery window ran out.
 */
export function transportGaveUp(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return /timed out|timeout|\b408\b|\b503\b|websocket|network error|failed to fetch|fetch failed/i.test(raw);
}

/**
 * What to tell someone whose join did not work.
 *
 * The two cases stay separate even here, past the end of the recovery window: a join that outlasted
 * the window may still be running (it is a budget, not a guarantee), which makes "try again" better
 * advice than it sounds — a second attempt is cheap once the dataset exists, because the backend
 * hands back the one it already made rather than making another.
 */
export const joinErrorMessage = (error: unknown): string =>
  transportGaveUp(error)
    ? 'This is taking longer than expected. The space may still be joining in the background — try again in a minute.'
    : "Couldn't join this space. Check the link and try again.";
