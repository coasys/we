import type { PerspectiveProxy } from '@coasys/ad4m';
import { LinkQuery } from '@coasys/ad4m';

import type { TestResult } from './types';

/** Produce a stub result for a not-yet-implemented test. */
export function stub(name: string): TestResult {
  return { name, passed: false, error: 'Not yet implemented', durationMs: 0 };
}

/** Run a single named assertion and capture pass/fail + duration. */
export async function test(name: string, fn: () => void | Promise<void>): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, passed: true, durationMs: Date.now() - start };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

/** Lightweight assertion used inside test() callbacks. */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Polls until `condition` returns (or resolves to) true, then returns.
 * Throws if `timeoutMs` elapses first.
 *
 * Accepts both sync and async condition functions so it can be used both for
 * subscription-result checks (`() => all.length > 0`) and for polling live
 * SurrealDB queries (`async () => (await findAll()).length > 0`).
 */
export async function waitUntil(condition: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (await condition()) return;
    if (Date.now() >= deadline) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Clears all links in a perspective in a single batch call.
 *
 * `perspective.removeLinks()` sends all removes as one mutation to the
 * executor, which processes them atomically — no need for a retry loop.
 */
export async function wipePerspective(perspective: PerspectiveProxy): Promise<void> {
  const links = await perspective.get(new LinkQuery({}));
  if (links.length > 0) {
    await perspective.removeLinks(links);
  }
}
