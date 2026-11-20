/**
 * What a feed-scale run measured, as the nightly performance history reads it, and as one line.
 *
 * `results.json` is `{"job": "feed-scale", "metrics": [...], "detail": {...}}`. Each metric is
 * `{metric, value, unit, better, params}` — the record format of ad4m's `scripts/perf/record`, which
 * takes this file as it is; `job` and `detail` are for a reader and ignored by it. `params` holds
 * what the numbers depend on (`{"messages": 1000000}`), so a run at another size is never compared
 * with this one.
 */

export const JOB = 'feed-scale';

/** The middle value; the mean of the two middle ones for an even count. `null` for none. */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const max = (values) => (values.length ? Math.max(...values) : null);

const round = (n, places = 1) => (n === null ? null : Math.round(n * 10 ** places) / 10 ** places);

/**
 * The metrics of a run, from what it measured. Anything not measured (a run that stopped early) is
 * left out rather than written as zero, so a partial run never sets a baseline it did not earn.
 *
 * `run`: `{messages, seed: {generateSeconds, importSeconds, links}, newest: [ms…], newestCold, older: [ms…],
 * queries: [ms…], otherQueries: [ms…], cpu: {uiPhase, idleAfterSeed, idleAfterUi},
 * rss: {afterSeed, afterUi, peak}, attempted, newestFailures: [kind…], olderAttempted,
 * olderFailures: [kind…], failedFeedCalls}` — times in milliseconds, memory in MiB. `newest` is
 * every drawn load's newest-page time; `newestCold` is the first load's own, kept apart so a cold
 * load that never drew does not lend a warm load's time to `feed.newest_page.cold`.
 * `seed.generateSeconds` is the time to build the links file; `seed.importSeconds` the executor's
 * `runtime.importData` of it. `cpu.uiPhase`
 * is the executor's CPU seconds over all the loads; `cpu.idle*` its CPU, as a percent of one core,
 * over a quiet spell with no page open: after the seeding (the space's watch removed) and after
 * the loads (the watch the app registered).
 * `queries` are the Feed's message window (`TextBlock`); `otherQueries` the rest of the same read
 * (calls, extracted kinds), which the page waits for as well.
 *
 * A run whose page never draws has no time to record: `attempted` counts the loads that reached an
 * outcome, the `*Failures` lists why each did not draw (`feed-call-refused`, `timeout`,
 * `page-closed`), and `failedFeedCalls` how many of the run's feed calls the executor answered with
 * an error.
 *
 * The failure counts and `cpu.uiPhase` add up over the loads, so their `params` also hold `loads`
 * (`run.loads`, the loads the run was set to make): a run of 1 load is not compared with one of 5.
 */
export function metrics(run) {
  const params = { messages: run.messages };
  const perLoads = { ...params, loads: run.loads };
  const out = [];
  const add = (metric, value, unit, better, p = params) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    out.push({ metric, value: round(value, unit === 'ms' || unit === 'MiB' ? 1 : 3), unit, better, params: p });
  };
  if (run.seed) {
    add('seed.generate_s', run.seed.generateSeconds, 's', 'lower');
    add('seed.import_s', run.seed.importSeconds, 's', 'lower');
    add('seed.links', run.seed.links, 'links', 'lower');
    // The executor's rate: the generation is the suite's own work, timed apart above.
    add('seed.links_per_second', run.seed.links / run.seed.importSeconds, 'links/s', 'higher');
  }
  const newest = run.newest ?? [];
  add('feed.newest_page.cold', run.newestCold ?? null, 'ms', 'lower');
  add('feed.newest_page.median', median(newest), 'ms', 'lower');
  add('feed.newest_page.max', max(newest), 'ms', 'lower');
  add('feed.older_page.median', median(run.older ?? []), 'ms', 'lower');
  add('feed.older_page.max', max(run.older ?? []), 'ms', 'lower');
  add('executor.feed_query.median', median(run.queries ?? []), 'ms', 'lower');
  add('executor.feed_query.max', max(run.queries ?? []), 'ms', 'lower');
  add('executor.feed_other_queries.max', max(run.otherQueries ?? []), 'ms', 'lower');
  // What never drew: recorded as a count, not absent — the page not loading is a result too. Only
  // for a run whose every load reached an outcome: a count over the loads before an interruption is
  // not the run's (the loads it reached stay in the detail).
  const complete = run.attempted > 0 && run.attempted === run.loads;
  if (complete) {
    add('feed.newest_page.failures', run.newestFailures?.length ?? 0, 'count', 'lower', perLoads);
    add('executor.feed_query.failures', run.failedFeedCalls ?? 0, 'count', 'lower', perLoads);
  }
  if (complete && run.olderAttempted) {
    add('feed.older_page.failures', run.olderFailures?.length ?? 0, 'count', 'lower', perLoads);
  }
  add('executor.cpu_seconds.ui_phase', run.cpu?.uiPhase ?? null, 's', 'lower', perLoads);
  add('executor.idle_cpu_percent.after_seed', run.cpu?.idleAfterSeed ?? null, '%', 'lower');
  add('executor.idle_cpu_percent.after_ui', run.cpu?.idleAfterUi ?? null, '%', 'lower');
  add('executor.rss.after_seed', run.rss?.afterSeed ?? null, 'MiB', 'lower');
  add('executor.rss.after_ui', run.rss?.afterUi ?? null, 'MiB', 'lower');
  add('executor.rss.peak', run.rss?.peak ?? null, 'MiB', 'lower');
  return out;
}

/** The job log's last line: every number of the run, or `-` where one was not measured. */
export function summaryLine(run, status) {
  const v = (n, unit = '') => (n === null || n === undefined ? '-' : `${Math.round(n)}${unit}`);
  const newest = run.newest ?? [];
  const older = run.older ?? [];
  const queries = run.queries ?? [];
  const failed = run.newestFailures ?? [];
  const olderFailed = run.olderFailures ?? [];
  return [
    `feed-scale ${status}:`,
    `messages=${run.messages}`,
    `seed=${run.seed ? `${v(run.seed.generateSeconds, 's')}+${v(run.seed.importSeconds, 's')}/${run.seed.links}links` : '-'}`,
    `newest(cold/median/max)=${v(run.newestCold ?? null)}/${v(median(newest))}/${v(max(newest))}ms`,
    `older(median/max)=${v(median(older))}/${v(max(older))}ms`,
    `query(median/max)=${v(median(queries))}/${v(max(queries))}ms`,
    `others(max)=${v(max(run.otherQueries ?? []))}ms`,
    `cpu(ui/idle-seed/idle-ui)=${v(run.cpu?.uiPhase, 's')}/${v(run.cpu?.idleAfterSeed, '%')}/${v(run.cpu?.idleAfterUi, '%')}`,
    `rss(seed/ui/peak)=${v(run.rss?.afterSeed)}/${v(run.rss?.afterUi)}/${v(run.rss?.peak)}MiB`,
    `runs=${newest.length}`,
    // Why runs did not draw, when any did not — "a slow or refused load is a result".
    ...(failed.length ? [`notdrawn=${failed.length}:${[...new Set(failed)].join('+')}`] : []),
    ...(olderFailed.length ? [`oldernotdrawn=${olderFailed.length}:${[...new Set(olderFailed)].join('+')}`] : []),
  ].join(' ');
}

/** The resident and peak memory of a process, in MiB, from `/proc/<pid>/status`. Null off Linux. */
export function memory(status) {
  const kib = (key) => {
    const m = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(status);
    return m ? Number(m[1]) / 1024 : null;
  };
  return { rss: kib('VmRSS'), peak: kib('VmHWM') };
}

/**
 * The CPU a process has used, user and system, in seconds, from `/proc/<pid>/stat`. `ticks` is the
 * kernel's clock ticks per second (`getconf CLK_TCK`). Null for a line it cannot read.
 *
 * The second field (the command) is in parentheses and may hold spaces, so the fields are counted
 * from the last `)`: utime and stime are the 14th and 15th.
 */
export function cpuSeconds(stat, ticks) {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  const fields = stat
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime) || !(ticks > 0)) return null;
  return (utime + stime) / ticks;
}

/**
 * Where one load's time went, in ms from its start: when the page first called the executor, when
 * its `Space` query was answered, when the Feed asked for its messages and was answered, when the
 * last author profile (`agent.byDid`) came back, when the app registered the space's watch
 * (`perspective.addAutoProcessor`), and when the newest message was visible and the window's last
 * row was in the DOM (`marks`, read in the page). `null` for a step the load did not take.
 *
 * `calls` are the load's calls as `watchFeedQueries` keeps them, with `sentAfterMs`.
 */
export function loadPhases(calls, marks = {}) {
  const done = (q) => q.sentAfterMs + q.ms;
  const first = (list, at) => (list.length ? Math.min(...list.map(at)) : null);
  const last = (list, at) => (list.length ? Math.max(...list.map(at)) : null);
  const feed = calls.filter((q) => q.feed && q.className === 'TextBlock');
  // The newest window's call is the Feed's first: its ask and its answer, not another call's answer.
  const newestCall = feed.length ? feed.reduce((a, b) => (b.sentAfterMs < a.sentAfterMs ? b : a)) : null;
  const space = calls.filter((q) => q.className === 'Space');
  const drawn = [marks.newestVisible, marks.lastAttached].filter((n) => typeof n === 'number');
  // Only the profiles asked before the page drew: what it could have been waiting on.
  const before = drawn.length ? Math.max(...drawn) : Infinity;
  const profiles = calls.filter((q) => q.type === 'agent.byDid' && q.sentAfterMs < before);
  // Only a call the executor accepted registers the watch: one answered with an error did not.
  const watch = calls.filter((q) => q.type === 'perspective.addAutoProcessor' && !q.error);
  return {
    firstCall: first(calls, (q) => q.sentAfterMs),
    spaceAnswered: first(space, done),
    feedAsked: newestCall ? newestCall.sentAfterMs : null,
    feedAnswered: newestCall ? done(newestCall) : null,
    profiles: profiles.length,
    profilesAnswered: last(profiles, done),
    watchRegistered: first(watch, done),
    newestVisible: marks.newestVisible ?? null,
    lastAttached: marks.lastAttached ?? null,
  };
}
