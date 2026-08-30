/**
 * The toast countdown, and the two things that were wrong with it.
 *
 * This package shipped `--passWithNoTests` and no tests, which is how eight defects in it stayed
 * open across three audits. These are the ones in this file: a message on a four-second timer that
 * could not be paused while somebody read it (WCAG 2.2.1), and the collapse rule it has to keep
 * working alongside.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toastService } from './toast.service';

describe('toastService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const toast of [...toastService.toasts()]) toastService.remove(toast.id);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dismisses itself when its time is up', () => {
    toastService.info('Saved', 1000);
    expect(toastService.toasts()).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(toastService.toasts()).toHaveLength(0);
  });

  it('holds the countdown while it is being read', () => {
    /*
      A message longer than four seconds' reading, or one somebody is reaching for the dismiss
      button on, or one a screen reader is part way through — all of them vanish underneath the
      reader. WCAG 2.2.1 says a time limit has to be extendable, and stopping the clock while the
      pointer or focus is on it is what anybody expects anyway.
    */
    const id = toastService.info('Something long enough to need reading', 1000);
    toastService.pause(id);

    vi.advanceTimersByTime(5000);
    expect(toastService.toasts()).toHaveLength(1);
  });

  it('starts counting again once attention moves on', () => {
    // Paused, not cancelled: nothing should accumulate on screen.
    const id = toastService.info('Saved', 1000);
    toastService.pause(id);
    vi.advanceTimersByTime(5000);

    toastService.resume(id);
    vi.advanceTimersByTime(1000);
    expect(toastService.toasts()).toHaveLength(0);
  });

  it('gives the full duration back on resume, since the point is reading time', () => {
    const id = toastService.info('Saved', 1000);
    vi.advanceTimersByTime(900);
    toastService.pause(id);
    toastService.resume(id);

    // The 900ms already spent is not counted against them.
    vi.advanceTimersByTime(900);
    expect(toastService.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(toastService.toasts()).toHaveLength(0);
  });

  it('is a no-op to pause or resume a toast that has gone', () => {
    const id = toastService.info('Saved', 1000);
    vi.advanceTimersByTime(1000);
    expect(() => {
      toastService.pause(id);
      toastService.resume(id);
    }).not.toThrow();
    expect(toastService.toasts()).toHaveLength(0);
  });

  it('collapses a repeat without restarting its countdown', () => {
    /*
      A condition can report many times — a reactive effect re-running, a retry loop — and N
      identical toasts is noise. Restarting the clock on each repeat would be worse still: a
      condition refiring faster than the duration would pin the message on screen indefinitely.
    */
    const first = toastService.info('Could not save', 1000);
    vi.advanceTimersByTime(600);
    const second = toastService.info('Could not save', 1000);

    expect(second).toBe(first);
    expect(toastService.toasts()).toHaveLength(1);

    vi.advanceTimersByTime(400);
    expect(toastService.toasts()).toHaveLength(0);
  });

  it('keeps two different messages apart', () => {
    toastService.info('One', 1000);
    toastService.error('Two', 1000);
    expect(toastService.toasts()).toHaveLength(2);
  });

  it('a duration of zero never dismisses itself', () => {
    toastService.info('Waiting on you', 0);
    vi.advanceTimersByTime(60_000);
    expect(toastService.toasts()).toHaveLength(1);
  });
});
