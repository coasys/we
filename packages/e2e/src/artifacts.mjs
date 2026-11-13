/**
 * What a failed journey leaves behind to be read: a screenshot and an accessibility snapshot of every
 * page it held, and the executor's log — in one directory per run.
 *
 * The directory is `WE_E2E_ARTIFACTS` when it is set (CI uploads it when a job fails), else a fresh
 * temp directory, said at the end of the run. A suite may name its own variable before that one: the
 * coasys-spaces suite keeps `COASYS_SPACES_ARTIFACTS`, which ad4m's nightly sets.
 *
 * Every write is best-effort. An artifact is there to explain a failure, so one that cannot be written
 * is said and never replaces the failure it was meant to explain.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** A name fit for a file: lower case, runs of anything else as one `-`. */
export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * The run's artifacts directory, made if it is not there: `dir` when given, else `WE_E2E_ARTIFACTS`,
 * else a new temp directory named with `prefix`.
 */
export function artifactsDir({ dir, prefix = 'we-e2e-', env = process.env } = {}) {
  const chosen = dir || env.WE_E2E_ARTIFACTS;
  const path = chosen ? resolve(chosen) : mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(path, { recursive: true });
  return path;
}

/** Writes one artifact, best-effort: a write that fails is said, and never stops what comes after it. */
export function saveArtifact(path, content) {
  try {
    writeFileSync(path, content);
    return true;
  } catch (error) {
    console.log(`e2e: could not write ${path}: ${error.message}`);
    return false;
  }
}

/**
 * For a step that failed: a full-page screenshot (`<name>-<label>.png`) and an ARIA snapshot
 * (`<name>-<label>.aria.txt`, the page's URL first) of every page given, and the executor's log so far
 * (`executor.log`). `pages` are Playwright pages, or `{ label, page }` to name each one; unnamed ones
 * are numbered. Resolves once every write has been tried.
 */
export async function captureFailure({ dir, name, pages = [], executor }) {
  const base = slug(name).slice(0, 80) || 'failure';
  for (const [i, entry] of pages.entries()) {
    const page = entry?.page ?? entry;
    const label = slug(entry?.label ?? String(i));
    const file = join(dir, `${base}-${label}`);
    try {
      await page.screenshot({ path: `${file}.png`, fullPage: true, timeout: 30_000 });
    } catch (error) {
      console.log(`e2e: no screenshot of ${file}: ${error.message}`);
    }
    const aria = await page
      .locator('body')
      .ariaSnapshot({ timeout: 10_000 })
      .catch((error) => `no snapshot: ${error.message}`);
    let url = '';
    try {
      url = page.url();
    } catch {
      url = '(closed)';
    }
    saveArtifact(`${file}.aria.txt`, `${url}\n\n${aria}`);
  }
  if (executor) saveArtifact(join(dir, 'executor.log'), executor.log?.() ?? executor.output?.join('') ?? '');
}

/**
 * A node:test body that, when it throws, runs `capture(title)` before the error goes on — so a test
 * written as `it(title, capturing(capture, async (t) => …))` leaves its artifacts on failure. `capture`
 * is usually `(title) => captureFailure({ dir, name: title, pages: …, executor })`.
 */
export function capturing(capture, fn) {
  return async (t) => {
    try {
      return await fn(t);
    } catch (error) {
      await Promise.resolve()
        .then(() => capture(t?.name ?? 'failure'))
        .catch((e) => console.log(`e2e: capturing a failure failed: ${e.message}`));
      throw error;
    }
  };
}
