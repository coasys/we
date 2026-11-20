/**
 * What a record going through a workflow is called on the Workflows page.
 *
 * Every row read "Untitled": the name was looked for only under a few fixed fields, and a record whose
 * model names itself any other way — or one not read yet — had nothing to show.
 */
import { describe, expect, it } from 'vitest';

import { shortIdOf, subjectLabel, subjectTitleOf } from '../src/shared/workflowSubjects';

describe('subjectTitleOf', () => {
  it('reads the field the model says names it, before the usual ones', () => {
    expect(subjectTitleOf({ headline: 'Fix the roof', title: 'ignored' }, 'headline')).toBe('Fix the roof');
  });

  it('falls back to the fields that name a record by convention', () => {
    expect(subjectTitleOf({ label: 'Quarterly review' })).toBe('Quarterly review');
    expect(subjectTitleOf({ textContent: '<p>Buy a <b>kettle</b></p>' })).toBe('Buy a kettle');
  });

  it('says nothing for a record with nothing to name it by', () => {
    expect(subjectTitleOf({ count: 3, title: '   ' })).toBe('');
  });

  it('shortens a long text to one line', () => {
    const title = subjectTitleOf({ text: 'word '.repeat(40) });
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('subjectLabel', () => {
  it('uses the title when there is one', () => {
    expect(subjectLabel({ title: 'Fix the roof', entity: 'TaskBlock' }, 'literal://abc123')).toBe('Fix the roof');
  });

  it('names the kind and a short id rather than "Untitled"', () => {
    expect(subjectLabel({ title: '', entity: 'TaskBlock' }, 'literal://string:9f8e7d6c5b')).toBe('Task 7d6c5b');
    expect(subjectLabel({ title: '', entity: '' }, 'r1')).toBe('Record r1');
  });
});

describe('shortIdOf', () => {
  it('keeps the tail of an id, letters and digits only', () => {
    expect(shortIdOf('literal://string:9f8e-7d6c-5b4a')).toBe('6c5b4a');
    expect(shortIdOf('')).toBe('');
  });
});
