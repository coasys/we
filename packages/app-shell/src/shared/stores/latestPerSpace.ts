import { type Latest, latest } from '@we/module-shared';

/**
 * `latest`, kept once for each space: a newer call for a space makes the older ones for that space
 * stale, and says nothing about another space's — a call still reading for one space must not be
 * cancelled by the user having moved on to start another's.
 */
export function latestPerSpace(): (spaceId: string) => Latest {
  const bySpace = new Map<string, Latest>();
  return (spaceId) => {
    let tracker = bySpace.get(spaceId);
    if (!tracker) {
      tracker = latest();
      bySpace.set(spaceId, tracker);
    }
    return tracker;
  };
}
