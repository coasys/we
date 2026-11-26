/**
 * What a message arriving costs the Feed, as every line is drawn from blocks.
 *
 * The Feed reads its window again when a line lands, so every line on screen comes back as a fresh
 * row object. Drawing a line from blocks means decoding and serialising it — cheap once, and a cost
 * per line on screen per message if it is done again for lines that did not change.
 *
 * ## The verdict
 *
 * Exact, not timed: after a message arrives, the words of every line that was already there are the
 * same DOM nodes they were before. Only the new line is drawn. That holds or it does not, on any
 * machine — where a millisecond threshold would be about this one.
 *
 * Milliseconds are printed beside it, over an idle frame, for a sense of size:
 * - `fill` — drawing the whole window from nothing, the cost of opening the Feed.
 * - `arrive` — one more message, the median of several.
 */
export const name = 'feed lines by window size';
export const scenario = 'perf:feedLines';
export const widths = [560];
/** The first page, a page scrolled back, and three. See `FEED_FIRST_PAGE` and `FEED_PAGE`. */
export const scales = [50, 150, 350];

const ARRIVALS = 5;

export async function check(api, width, scale) {
  const problems = [];
  const idle = await api.profile('idle', [1]);
  const over = (run) => Math.round((run.ms - idle.ms) * 10) / 10;

  await api.profile('act', ['clear']);
  const fill = await api.profile('act', ['refill']);

  const times = [];
  let redrawn = 0;
  for (let k = 0; k < ARRIVALS; k += 1) {
    // Tag the words every line is drawn as, so a redraw shows up as an untagged node.
    const tagged = await api.evaluate(() => {
      const words = [...document.querySelectorAll('.we-block-renderer > *')];
      for (const el of words) el.__beforeArrival = true;
      return words.length;
    });
    const run = await api.profile('act', ['arrive']);
    times.push(over(run));
    const fresh = await api.evaluate(
      () => [...document.querySelectorAll('.we-block-renderer > *')].filter((el) => !el.__beforeArrival).length,
    );
    if (k === 0 && !tagged) problems.push('no line is drawn from blocks');
    // The line that arrived is new; anything past that was drawn again.
    redrawn = Math.max(redrawn, fresh - 1);
  }
  times.sort((a, b) => a - b);
  api.note(
    `${scale} lines  fill ms=${over(fill)}  arrive ms=${times[Math.floor(times.length / 2)]} (median of ${ARRIVALS})`,
  );
  if (redrawn > 0)
    problems.push(`a message arriving drew ${redrawn} unchanged line(s) again; only the new one should be drawn`);
  return problems;
}
