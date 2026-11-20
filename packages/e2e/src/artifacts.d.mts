import type { Page } from 'playwright-core';

/** A name fit for a file: lower case, runs of anything else as one `-`. */
export function slug(s: unknown): string;

/** `dir`, else `WE_E2E_ARTIFACTS`, else a new temp directory named with `prefix`; made if missing. */
export function artifactsDir(options?: {
  dir?: string;
  prefix?: string;
  env?: Record<string, string | undefined>;
}): string;

/** Writes one artifact, best-effort; false when the write failed (and was said). */
export function saveArtifact(path: string, content: string | Uint8Array): boolean;

/** Screenshot and ARIA snapshot of every page, and the executor's log, for a failed step. */
export function captureFailure(options: {
  dir: string;
  name: string;
  pages?: Array<Page | { label: string; page: Page }>;
  executor?: { log?(): string; output?: string[] };
}): Promise<void>;

/** Wraps a node:test body so that a throw runs `capture(<test name>)` before it goes on. */
export function capturing<C extends { name?: string } | undefined, R>(
  capture: (title: string) => unknown,
  fn: (t: C) => R | Promise<R>,
): (t: C) => Promise<R>;
