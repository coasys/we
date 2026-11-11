/**
 * The coasys-spaces suite: every vertical, in order, in one process — so they share one executor,
 * one served app and one browser (`context.mjs`), each with its own space and people.
 *
 * `COASYS_SPACES_ONLY=v2,v4` runs only the verticals named, for working on one.
 */
const ONLY = (process.env.COASYS_SPACES_ONLY ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const VERTICALS = [
  ['v1', './v1-space.live.mjs'],
  ['v2', './v2-call-extraction.live.mjs'],
  ['v3', './v3-social-dna.live.mjs'],
  ['v4', './v4-decide-flow.live.mjs'],
  ['v5', './v5-build-agent.live.mjs'],
  ['v6', './v6-interfaces-feed.live.mjs'],
];

// A name that is not a vertical would run fewer verticals than asked for, or none, and still pass.
const unknown = ONLY.filter((key) => !VERTICALS.some(([k]) => k === key));
if (unknown.length) {
  throw new Error(
    `COASYS_SPACES_ONLY names no vertical: ${unknown.join(', ')}. The verticals are ${VERTICALS.map(([k]) => k).join(', ')}.`,
  );
}

for (const [key, path] of VERTICALS) {
  if (!ONLY.length || ONLY.includes(key)) await import(path);
}
