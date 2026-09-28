/**
 * The pretend people a development build can add to a weighed canvas: how many, who the reader
 * answers as, and the answers given while acting — kept on the device, never written anywhere.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  actAs,
  actingAs,
  answerAs,
  forgetPretendAnswers,
  pretendPeople,
  pretendSettings,
  setPretendCount,
} from '../src/shared/pretendPeople';

// The node project has no storage; a map stands in, which is all the module asks of one.
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

afterEach(() => {
  forgetPretendAnswers();
  actAs('');
  setPretendCount(0);
});

describe('pretend people', () => {
  it('hand the seed nothing until somebody asks for them', () => {
    expect(pretendSettings()).toBeUndefined();
    setPretendCount(2);
    expect(pretendSettings()?.people).toEqual([
      { id: 'pretend:1', name: 'Ada' },
      { id: 'pretend:2', name: 'Bo' },
    ]);
  });

  it('are kept across a reload, and capped', () => {
    setPretendCount(3);
    expect(JSON.parse(localStorage.getItem('we.graph.pretendPeople') ?? '{}').count).toBe(3);
    setPretendCount(500);
    expect(pretendPeople().length).toBe(12);
  });

  it('carry the answers given while acting as one of them, and who that was', () => {
    setPretendCount(2);
    actAs('pretend:2');
    answerAs('pretend:2', 'card-1', 4);
    answerAs('pretend:2', 'card-2', null);
    expect(pretendSettings()).toMatchObject({
      actingAs: 'pretend:2',
      answers: { 'pretend:2|card-1': 4, 'pretend:2|card-2': null },
    });
  });

  it('hand the reader back to themselves when the one they were acting as is taken away', () => {
    setPretendCount(2);
    actAs('pretend:2');
    setPretendCount(1);
    expect(actingAs()).toBe('');
    expect(pretendSettings()?.actingAs).toBeUndefined();
  });
});
