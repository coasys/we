/**
 * The switch that turns ephemeral tracing on, and where the lines come out.
 *
 * ## Using it
 *
 * In the console of **both** agents:
 *
 * ```js
 * localStorage.setItem('we:trace', 'presence,ephemeral');  // then reload
 * localStorage.removeItem('we:trace');                     // off again
 * ```
 *
 * Scopes are comma-separated; `*` or `all` enables everything. Lines look like:
 *
 * ```
 * we:trace  +0ms      presence start        {"agentId":"did:key:z6Mk…"}
 * we:trace  +2ms      presence send         {"lifecycle":"hello","activities":0}
 * we:trace  +181ms    ephemeral send:ok     {"tag":"presence","ms":179}
 * we:trace  +934ms    ephemeral recv        {"tag":"presence","from":"did:key:z6Mk…"}
 * ```
 *
 * ## Reading it
 *
 * The elapsed column is since the previous line, so a gap is the thing to look for. Which hop the
 * gap sits in is the whole diagnosis, and the three cases look nothing alike:
 *
 * - **`send` with no following `send:ok`, or a large `ms`** — the executor is slow or wedged. Ours
 *   to route around only by not making it worse; `publish:queued` lines alongside mean coalescing is
 *   doing its job.
 * - **`send:ok` on one agent, no matching `recv` on the other** — the broadcast was accepted and
 *   never delivered. That is the network: Holochain remote signals are best-effort and two peers
 *   that have not finished discovering each other simply do not exchange them. `handshake:retry`
 *   lines are the repair working.
 * - **`publish:suppressed`** — ours, and the only one that is a bug. It means a tab published into a
 *   closed leadership gate.
 *
 * The asymmetric case — one agent sees the other but not vice versa — is worth stating plainly,
 * because it rules the most tempting explanations out: loss is independent per direction, so one-way
 * delivery is evidence *for* the transport and against anything in the shared logic above it.
 *
 * ## Why a switch rather than a flag in the seed
 *
 * It has to be flippable on a build that is already running and already misbehaving, on both
 * machines, without a rebuild. `localStorage` is the only thing that fits, and tracing costs one
 * null check when it is off.
 */
import { setTraceSink } from '@we/backend-shared';

const STORAGE_KEY = 'we:trace';

/** Scopes emitted anywhere in the codebase, for the "what can I turn on" question. */
export const TRACE_SCOPES = ['presence', 'ephemeral'] as const;

function enabledScopes(): Set<string> | null {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode. Not being able to read the switch is the same as it being off.
    return null;
  }
  if (!raw) return null;
  const scopes = raw
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
  return new Set(scopes.length ? scopes : ['*']);
}

/**
 * Install the console sink if the switch is set. Safe to call at boot on every host.
 *
 * Returns whether tracing was turned on, so a caller can say so — a trace nobody can see they
 * enabled is worse than none.
 */
export function installConsoleTrace(): boolean {
  const scopes = enabledScopes();
  if (!scopes) return false;

  const all = scopes.has('*') || scopes.has('all');
  let last = Date.now();

  setTraceSink((scope, event, detail) => {
    if (!all && !scopes.has(scope)) return;
    const now = Date.now();
    const since = now - last;
    last = now;
    // One line, fixed columns, detail as JSON: this gets read side by side with another machine's
    // console, and wrapped multi-line objects make two logs impossible to line up by eye.
    console.log(`we:trace  +${since}ms\t${scope} ${event}\t${detail ? JSON.stringify(detail) : ''}`.trimEnd());
  });

  console.info(
    `we:trace enabled for [${all ? '*' : [...scopes].join(', ')}]. ` +
      `Disable with localStorage.removeItem('${STORAGE_KEY}').`,
  );
  return true;
}
