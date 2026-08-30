/**
 * Turning a thrown thing into a sentence somebody can act on.
 *
 * ## Why a helper rather than `error.message`
 *
 * Six call sites did `${error instanceof Error ? error.message : 'Unknown error'}` and put the
 * result in a toast. That reads as thorough and is the wrong thing twice over.
 *
 * A backend message is written for whoever is reading the stack, so what lands in front of a person
 * is `AD4M error: gql: Failed to execute perspectiveAddLink: ...`. It says nothing they could do,
 * it is often longer than the toast, and where the failure is a *network* one it says the same
 * thing whether the node is asleep, the password is wrong, or the neighbourhood is gone. It also
 * publishes internals — a path, a query, occasionally a URL with a token in it — into a surface
 * that has no trust boundary in front of it, and templates render toasts too.
 *
 * The fix is not to hide the detail. `explain()` keeps the raw error going to the console, where
 * a developer or a bug report can reach it, and answers with the shortest true sentence: a
 * recognised *class* of failure where the text supports one, and the caller's own fallback where
 * it does not. The fallback is the caller's because only the caller knows what was being attempted,
 * which is the part of "what went wrong" a person actually needs.
 *
 * ## Why recognition is by substring and not by type
 *
 * Nothing this crosses throws typed errors: the AD4M client rethrows GraphQL strings, `fetch`
 * throws a `TypeError`, and a Holochain failure arrives as text from three layers down. So this
 * matches on what is reliably present, and deliberately recognises very little — a wrong guess
 * that reassures somebody about the wrong problem is worse than the honest fallback.
 */

/** Messages that mean "the node is not reachable", whatever layer noticed. */
const OFFLINE = ['failed to fetch', 'networkerror', 'econnrefused', 'socket hang up', 'not connected'];

/** Messages that mean "the node refused us", as opposed to failing. */
const REFUSED = ['unauthorized', 'unauthenticated', 'not authorized', 'capability', 'forbidden'];

/** Messages that mean "it took too long", which is the one class worth suggesting a retry for. */
const TIMEOUT = ['timeout', 'timed out', 'deadline exceeded'];

/**
 * A sentence for a person, and the whole error for the console.
 *
 * `fallback` is what to say when nothing is recognised — write it as the thing that did not happen
 * ("Could not publish this template"), not as the word "error".
 */
export function explain(error: unknown, fallback: string): string {
  // Always, and before anything else: whatever this returns, the real error must still be reachable.
  console.error(fallback, error);

  const text = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (!text) return fallback;

  if (OFFLINE.some((needle) => text.includes(needle))) return `${fallback} — this device could not reach the node.`;
  if (REFUSED.some((needle) => text.includes(needle))) return `${fallback} — this node refused the request.`;
  if (TIMEOUT.some((needle) => text.includes(needle))) return `${fallback} — it took too long. Try again.`;

  return fallback;
}
