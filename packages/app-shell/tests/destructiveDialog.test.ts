/**
 * What the host says when a template asks to delete something.
 *
 * Written in the host's own words rather than the template's, because the template is the thing
 * being guarded against. What is worth testing is that the words are *true of the request* — a
 * dialog that said "this record" about seven of them would be the guard misreporting the very thing
 * somebody is about to answer.
 */
import { describe, expect, it } from 'vitest';

import { describeDestructive } from '../src/shared/destructiveWording';

describe('deleting a set of records', () => {
  const ask = (records: unknown) => describeDestructive('recordStore.deleteRecords', [records]);

  it('counts what is in the list', () => {
    /*
      The number is the whole reason this case exists. Somebody answering "delete these?" over a
      rubber-band selection cannot count what is inside a dashed rectangle on a dense canvas, and
      the difference between three and thirty is the difference between yes and no.
    */
    const many = ask([
      { recordId: 'a', recordType: 'TaskBlock' },
      { recordId: 'b', recordType: 'TaskBlock' },
      { recordId: 'c', recordType: 'TaskBlock' },
    ]);

    expect(many.title).toBe('Delete 3 TaskBlocks?');
    expect(many.body).toContain('everyone in this space');
  });

  it('names the kind where the set agrees on one', () => {
    // A sweep usually catches one kind of thing, and naming it says what is about to be lost where
    // a bare count says only how much.
    expect(ask([{ recordId: 'a', recordType: 'EventBlock' }]).title).toBe('Delete this EventBlock?');
  });

  it('falls back to "records" for a mixed selection', () => {
    const mixed = ask([
      { recordId: 'a', recordType: 'TaskBlock' },
      { recordId: 'b', recordType: 'EventBlock' },
    ]);

    expect(mixed.title).toBe('Delete 2 records?');
  });

  it('says something rather than nothing for a request it cannot read', () => {
    // The direction to fail in: a destructive action whose arguments surprise this still gets a
    // dialog, rather than a confident sentence about a count of zero.
    expect(ask(undefined).title).toBe('Delete 0 records?');
    expect(ask([{ recordId: 'a' }]).title).toBe('Delete this record?');
  });
});
