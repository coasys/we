/**
 * Which watched passes get written down, and as what.
 *
 * The rule lives in `activityView.ts` rather than the store because it is a sentence about rows,
 * and every way of getting it wrong produces a *quiet* wrong answer — a duplicate line in a
 * log nobody counts, a history of who was watching rather than of what was read, or an entry whose
 * prompt is blank because it was read off the wrong event.
 *
 * The point of writing these at all is that a pass somebody pressed for and a pass a watch ran are
 * then one list, told apart by a flag rather than by which surface happens to be on screen.
 */
import { watchPassRecord } from '@shared/interpretation/activityView';
import { describe, expect, it } from 'vitest';

/** A settled automatic pass of this agent's own, over a known call — the row that should be kept. */
const auto = {
  trigger: 'auto' as const,
  mine: true,
  collection: 'we://collection/today',
  phase: 'done',
  settled: true,
  ids: ['we://task/a', 'we://task/b'],
  llm: { prompt: '{"turns":[]}', response: '{"records":[]}' },
};

describe('writing down a watched pass', () => {
  it('keeps this agent’s own settled automatic pass, with what it read', () => {
    expect(watchPassRecord(auto)).toEqual({
      collection: 'we://collection/today',
      outcome: 'done',
      recordCount: 2,
      error: undefined,
      prompt: '{"turns":[]}',
      response: '{"records":[]}',
    });
  });

  it('refuses a one-shot, which its own run already wrote', () => {
    // Both kinds go in one list; only one of them is written from here. Writing this too would put
    // every manual pass in the log twice, which is worse than the split it was meant to fix.
    expect(watchPassRecord({ ...auto, trigger: 'manual' })).toBeNull();
  });

  it('refuses a pass with no trigger at all', () => {
    // A row relayed by a peer running an executor that predates the field. Nothing says it is
    // automatic, and guessing would make the log claim something that was never reported.
    expect(watchPassRecord({ ...auto, trigger: undefined })).toBeNull();
  });

  it('refuses a peer’s pass — every peer receives the same events', () => {
    // Otherwise five people in a call write five records for one pass, and the history becomes a
    // record of who had the panel open.
    expect(watchPassRecord({ ...auto, mine: false })).toBeNull();
  });

  it('refuses a pass with nothing to hang the record off', () => {
    // The log is scoped by containment, so an unparented record would be written and then be
    // invisible to the only list that reads them.
    expect(watchPassRecord({ ...auto, collection: undefined })).toBeNull();
  });

  it('refuses a pass still running', () => {
    expect(watchPassRecord({ ...auto, phase: 'thinking', settled: false })).toBeNull();
  });

  it('carries the reason a failed pass failed, and only then', () => {
    const failed = watchPassRecord({ ...auto, phase: 'failed', ids: [], detail: 'the model refused' });
    expect(failed).toMatchObject({ outcome: 'failed', recordCount: 0, error: 'the model refused' });
    // `detail` on a settled-but-fine pass is a progress note, not an error, and storing it as one
    // would draw a warning glyph on a pass that worked.
    expect(watchPassRecord({ ...auto, detail: 'batch 2 of 2' })?.error).toBeUndefined();
  });

  it('counts nothing as nothing rather than as absent', () => {
    // A pass that ran and found nothing is a real outcome and reads as "No records"; leaving the
    // count off would make it indistinguishable from a row written before counts were stored.
    expect(watchPassRecord({ ...auto, ids: undefined })?.recordCount).toBe(0);
  });

  it('keeps a settled pass whose exchange never arrived', () => {
    // A skipped pass never reaches the model, so it has no prompt — but it is still the answer to
    // "was this call read?", which is the question the log exists for.
    expect(watchPassRecord({ ...auto, phase: 'skipped', ids: [], llm: undefined })).toMatchObject({
      outcome: 'skipped',
      prompt: undefined,
      response: undefined,
    });
  });
});
