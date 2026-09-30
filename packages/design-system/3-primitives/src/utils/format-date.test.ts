import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './format-date';

/** A fixed reference point, so these assert on formatting rather than on when they ran. */
const NOW = new Date('2026-08-24T12:00:00Z');
const ago = (ms: number) => formatRelativeTime(new Date(NOW.getTime() - ms), NOW);
const ahead = (ms: number) => formatRelativeTime(new Date(NOW.getTime() + ms), NOW);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it('reads anything under a minute as "now"', () => {
    /*
      The regression this exists for.

      It used to fall through to second granularity, so a moment ago rendered as "12 seconds ago" —
      and `we-timestamp`, its only consumer, refreshes once a minute, leaving that frozen at twelve
      for the next fifty-eight. It said something false for almost all of the time it was on screen.

      A formatter cannot claim finer precision than the thing displaying it can refresh at.
    */
    expect(ago(0)).toBe('now');
    expect(ago(12 * SECOND)).toBe('now');
    expect(ago(59 * SECOND)).toBe('now');
    expect(ahead(30 * SECOND)).toBe('now');
  });

  it('counts in minutes from a minute', () => {
    expect(ago(MINUTE)).toBe('1 minute ago');
    expect(ago(2 * MINUTE)).toBe('2 minutes ago');
    expect(ago(59 * MINUTE)).toBe('59 minutes ago');
  });

  it('steps up through the larger units', () => {
    expect(ago(HOUR)).toBe('1 hour ago');
    expect(ago(3 * HOUR)).toBe('3 hours ago');
    expect(ago(2 * DAY)).toBe('2 days ago');
  });

  it('reads forwards as well as back', () => {
    expect(ahead(5 * MINUTE)).toBe('in 5 minutes');
    expect(ahead(2 * HOUR)).toBe('in 2 hours');
  });

  it('uses the named forms `numeric: "auto"` provides', () => {
    // The reason that option is set: "yesterday" rather than "1 day ago", and "now" rather than
    // "in 0 seconds".
    expect(ago(DAY)).toBe('yesterday');
    expect(ahead(DAY)).toBe('tomorrow');
  });
});
