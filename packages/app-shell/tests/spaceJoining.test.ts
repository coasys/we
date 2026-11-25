/**
 * How a join is addressed and when a failed one is worth waiting out — the pure half of
 * `SpaceStore.joinSpace`, tested without a provider.
 */
import { describe, expect, it } from 'vitest';

import {
  datasetAnswersTo,
  joinErrorMessage,
  joinTargetOf,
  sharedIdOf,
  transportGaveUp,
} from '../src/shared/stores/space/joining';

describe('sharedIdOf', () => {
  it('reduces a web link, a backend URI and a bare id to the same id', () => {
    expect(sharedIdOf('https://we.example/space/abc123')).toBe('abc123');
    expect(sharedIdOf('https://we.example/space/abc123/feed')).toBe('abc123');
    expect(sharedIdOf('neighbourhood://abc123')).toBe('abc123');
    expect(sharedIdOf('  abc123  ')).toBe('abc123');
  });

  it('takes the last path segment of a web link with no /space/ in it', () => {
    expect(sharedIdOf('https://we.example/join/abc123')).toBe('abc123');
  });

  it('answers empty for empty input', () => {
    expect(sharedIdOf('   ')).toBe('');
  });
});

describe('joinTargetOf', () => {
  it('unwraps a web link and passes every other form through trimmed', () => {
    expect(joinTargetOf('https://we.example/space/abc123')).toBe('abc123');
    expect(joinTargetOf(' neighbourhood://abc123 ')).toBe('neighbourhood://abc123');
    expect(joinTargetOf('abc123')).toBe('abc123');
  });
});

describe('datasetAnswersTo', () => {
  const ds = { id: 'local-1', sharedId: 'abc123', sharedUri: 'neighbourhood://abc123' };

  it('matches the dataset by its own id, its shared id, its URI or a web link to it', () => {
    expect(datasetAnswersTo(ds, 'local-1')).toBe(true);
    expect(datasetAnswersTo(ds, 'abc123')).toBe(true);
    expect(datasetAnswersTo(ds, 'neighbourhood://abc123')).toBe(true);
    expect(datasetAnswersTo(ds, 'https://we.example/space/abc123')).toBe(true);
  });

  it('does not match another space', () => {
    expect(datasetAnswersTo(ds, 'https://we.example/space/other')).toBe(false);
  });
});

describe('transportGaveUp and joinErrorMessage', () => {
  it('treats a timeout or a dropped connection as the call giving up', () => {
    expect(transportGaveUp(new Error('Request timed out'))).toBe(true);
    expect(transportGaveUp('HTTP 408')).toBe(true);
    expect(transportGaveUp(new Error('websocket closed'))).toBe(true);
    expect(joinErrorMessage(new Error('Request timed out'))).toMatch(/taking longer than expected/);
  });

  it('treats any other error as the backend having answered', () => {
    expect(transportGaveUp(new Error('No neighbourhood at that address'))).toBe(false);
    expect(joinErrorMessage(new Error('No neighbourhood at that address'))).toMatch(/Check the link/);
  });
});
