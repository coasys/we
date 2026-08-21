/**
 * Tests for the model → form derivation.
 *
 * Every failure here is quiet. A field dropped from the list is a value nobody can set, a control
 * chosen wrongly is a date typed by hand, and a blank optional written through as `''` is a
 * property that can never be cleared afterwards — none of which throws, and all of which look like
 * "the form is a bit wrong".
 */
import {
  asEntityName,
  controlFor,
  emptyRecordDraft,
  fieldsFor,
  humanise,
  recordDraftErrors,
  recordDraftFields,
  writeFieldValue,
} from '@shared/shapes/recordDraft';
import type { EntitySchema } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

const task: EntitySchema = {
  authoring: { fields: ['title', 'status', 'dueDate'] },
  properties: {
    title: { type: 'string', required: true, default: '' },
    status: { type: 'string', options: ['todo', 'done'], default: 'todo' },
    dueDate: { type: 'string', control: 'date', default: '' },
    version: { type: 'number', default: 0 },
  },
  relations: {},
};

describe('asEntityName', () => {
  it('keeps a model name', () => {
    expect(asEntityName('TaskBlock')).toBe('TaskBlock');
  });

  it('discards anything that is not one', () => {
    // The case that actually happened: `$action` with no `args` forwards the handler's own
    // arguments, so a button calling a store method with an optional leading parameter hands it a
    // PointerEvent. Read as a model name it produced `No model named "[object PointerEvent]"`.
    expect(asEntityName(new Error('not a name'))).toBe('');
    expect(asEntityName(undefined)).toBe('');
    expect(asEntityName({ type: 'pointerdown' })).toBe('');
  });
});

describe('humanise', () => {
  it('reads a property name as a sentence, not a heading', () => {
    expect(humanise('dueDate')).toBe('Due date');
  });

  it('keeps acronyms that title-casing would mangle', () => {
    expect(humanise('url')).toBe('URL');
    expect(humanise('thumbnailUrl')).toBe('Thumbnail URL');
  });
});

describe('controlFor', () => {
  it('prefers a closed vocabulary over everything else', () => {
    // A text box beside a list of allowed values is how an unrecognised value gets written.
    expect(controlFor({ type: 'string', options: ['a', 'b'], control: 'textarea' })).toBe('select');
  });

  it('takes the declared control where the type does not say', () => {
    expect(controlFor({ type: 'string', control: 'date' })).toBe('date');
  });

  it('falls back to the scalar type', () => {
    expect(controlFor({ type: 'boolean' })).toBe('switch');
    expect(controlFor({ type: 'number' })).toBe('number');
    expect(controlFor({ type: 'string' })).toBe('text');
  });
});

describe('fieldsFor', () => {
  it('offers exactly the fields a core entity declares, in that order', () => {
    // `version` is bookkeeping. A form that showed it would ask a person to fill in the
    // implementation, which is the whole reason the declaration names fields rather than hiding them.
    expect(fieldsFor(task, false).map((f) => f.name)).toEqual(['title', 'status', 'dueDate']);
  });

  it('offers nothing for a core entity that never opted in', () => {
    const infrastructure: EntitySchema = { properties: { key: { type: 'string' } }, relations: {} };
    expect(fieldsFor(infrastructure, false)).toEqual([]);
  });

  it("offers every property of a model the community wrote, since all of them are the author's", () => {
    const shape: EntitySchema = {
      properties: { name: { type: 'string', required: true }, colour: { type: 'string' } },
      relations: {},
    };
    expect(fieldsFor(shape, true).map((f) => f.name)).toEqual(['name', 'colour']);
  });

  it('skips a declared field the entity does not actually have', () => {
    const broken: EntitySchema = {
      authoring: { fields: ['title', 'ghost'] },
      properties: { title: { type: 'string' } },
      relations: {},
    };
    expect(fieldsFor(broken, false).map((f) => f.name)).toEqual(['title']);
  });

  it('starts each field at its declared default', () => {
    const fields = fieldsFor(task, false);
    expect(fields.find((f) => f.name === 'status')?.value).toBe('todo');
  });
});

describe('writing a value', () => {
  it('keeps the field objects it was given', () => {
    // The regression: `$each` renders rows with Solid's `<For>`, which keys on object identity. A
    // draft rebuilt on every keystroke gave every row a new object, so every control was torn down
    // and remade — and the input being typed into lost focus after a single character.
    const draft = emptyRecordDraft({ entity: 'TaskBlock', schema: task, authorable: false });
    const fields = draft.fields;
    const title = draft.fields[0];

    writeFieldValue(draft, 'title', 'Ship the docs');

    expect(draft.fields).toBe(fields);
    expect(draft.fields[0]).toBe(title);
    expect(title.value).toBe('Ship the docs');
  });

  it('ignores a name the draft does not have', () => {
    // `Relationship.relationshipTypeId` is deliberately absent from its authoring fields, and the
    // kind picker was writing to it through here — finding nothing and silently doing nothing.
    const draft = emptyRecordDraft({ entity: 'TaskBlock', schema: task, authorable: false });

    expect(() => writeFieldValue(draft, 'nothingNamedThis', 'x')).not.toThrow();
    expect(recordDraftFields(draft)).not.toHaveProperty('nothingNamedThis');
  });
});

describe('saving a draft', () => {
  it('refuses a required field left blank, naming it as the label reads', () => {
    const draft = emptyRecordDraft({ entity: 'TaskBlock', schema: task, authorable: false });
    expect(recordDraftErrors(draft)).toEqual(['Title is required.']);
  });

  it('passes once the required field is filled', () => {
    const draft = emptyRecordDraft({ entity: 'TaskBlock', schema: task, authorable: false });
    draft.fields[0].value = 'Ship the docs';
    expect(recordDraftErrors(draft)).toEqual([]);
  });

  it('drops a blank optional rather than writing an empty string', () => {
    // The ORM skips an empty string on update, so a written `''` is a value that cannot later be
    // cleared — worse than absent, and indistinguishable from it on screen.
    const draft = emptyRecordDraft({ entity: 'TaskBlock', schema: task, authorable: false });
    draft.fields[0].value = 'Ship the docs';

    expect(recordDraftFields(draft)).toEqual({ title: 'Ship the docs', status: 'todo' });
  });

  it('writes numbers as numbers, not as the strings an input hands back', () => {
    const point: EntitySchema = {
      authoring: { fields: ['lat'] },
      properties: { lat: { type: 'number', required: true, default: 0 } },
      relations: {},
    };
    const draft = emptyRecordDraft({ entity: 'Point', schema: point, authorable: false });
    draft.fields[0].value = '51.5';

    expect(recordDraftFields(draft)).toEqual({ lat: 51.5 });
  });
});
