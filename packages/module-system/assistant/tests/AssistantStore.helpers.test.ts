import { describe, expect, it } from 'vitest';

import { parseIdList, parseToolCalls } from '../src/store';

describe('AssistantStore helpers', () => {
  describe('parseIdList', () => {
    it('parses a JSON string array of ids', () => {
      expect(parseIdList('["a","b","c"]')).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty array for empty / undefined input', () => {
      expect(parseIdList('')).toEqual([]);
      expect(parseIdList(undefined)).toEqual([]);
      expect(parseIdList('[]')).toEqual([]);
    });

    it('is tolerant of malformed JSON', () => {
      expect(parseIdList('not json')).toEqual([]);
      expect(parseIdList('{"a":1}')).toEqual([]);
    });

    it('filters out non-string entries', () => {
      expect(parseIdList('["a", 2, null, "b"]')).toEqual(['a', 'b']);
    });
  });

  describe('parseToolCalls', () => {
    it('parses a JSON array of tool calls', () => {
      const json = JSON.stringify([
        { id: '1', name: 'get_weather', input: { city: 'Melbourne' }, result: { tempC: 14 }, status: 'complete' },
      ]);
      const calls = parseToolCalls(json);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('get_weather');
      expect(calls[0].status).toBe('complete');
      expect((calls[0].result as { tempC: number }).tempC).toBe(14);
    });

    it('returns an empty array for empty / undefined / malformed input', () => {
      expect(parseToolCalls('')).toEqual([]);
      expect(parseToolCalls(undefined)).toEqual([]);
      expect(parseToolCalls('nope')).toEqual([]);
      expect(parseToolCalls('{"not":"array"}')).toEqual([]);
    });
  });
});
