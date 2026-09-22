import { describe, expect, it } from 'vitest';

import type { EntitySchema } from './manifest';
import { nameFromProperties, namePropertyOf } from './recordName';

const entity = (properties: EntitySchema['properties'], display?: EntitySchema['display']): EntitySchema => ({
  properties,
  relations: {},
  ...(display ? { display } : {}),
});

describe('what names a record', () => {
  it('takes the property the model declares', () => {
    const shape = entity(
      { species: { type: 'string', required: true }, nickname: { type: 'string' } },
      {
        title: 'nickname',
      },
    );
    expect(namePropertyOf(shape)).toBe('nickname');
  });

  it('ignores a declared name the model no longer has', () => {
    // A rename would otherwise leave every surface reading an absent field, which renders as
    // nothing at all — worse than the guess, and silent.
    const shape = entity({ species: { type: 'string', required: true } }, { title: 'formerName' });
    expect(namePropertyOf(shape)).toBe('species');
  });

  it('prefers a conventional name to a required one', () => {
    /*
      The defect this exists for. `CodeBlock`'s only required string is `code`, so "the first
      required string" put the entire code body in the card heading and its actual title on the
      summary line beneath. Required-ness is a fact about storage; being called `title` is a
      statement about meaning.
    */
    const code = entity({
      code: { type: 'string', control: 'textarea', required: true },
      language: { type: 'string' },
      title: { type: 'string' },
    });
    expect(namePropertyOf(code)).toBe('title');

    // Same shape of mistake, same fix: a link card headed by its URL.
    const link = entity({
      url: { type: 'string', required: true },
      title: { type: 'string' },
      description: { type: 'string' },
    });
    expect(namePropertyOf(link)).toBe('title');
  });

  it('reads every property, not only the ones a form asks for', () => {
    // A composed document declares no field list — nobody types a post into a form — and its name
    // was therefore unreachable, however plainly `title` said so.
    const collection = entity({
      editorState: { type: 'string', format: 'file' },
      type: { type: 'string' },
      title: { type: 'string' },
    });
    expect(namePropertyOf(collection)).toBe('title');
  });

  it('never names a record by a stored file', () => {
    const shape = entity({ name: { type: 'string', format: 'file' }, subject: { type: 'string', required: true } });
    expect(namePropertyOf(shape)).toBe('subject');
  });

  it('falls back to the shape when nothing is declared or conventionally named', () => {
    // A community's own model, or a foreign class: the permanent case, since structure is all a
    // SHACL shape carries.
    expect(
      nameFromProperties([
        { name: 'seenAt', type: 'datetime' },
        { name: 'species', type: 'string', required: true },
        { name: 'notes', type: 'string' },
      ]),
    ).toBe('species');

    // No required string either — the first string, which is declaration order.
    expect(
      nameFromProperties([
        { name: 'count', type: 'number' },
        { name: 'notes', type: 'string' },
        { name: 'subject', type: 'string' },
      ]),
    ).toBe('notes');
  });

  it('answers with nothing rather than naming a record by a number', () => {
    expect(
      nameFromProperties([
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' },
      ]),
    ).toBe('');
    expect(namePropertyOf(entity({ x: { type: 'number' } }))).toBe('');
  });

  it('orders the conventional names by how deliberately they name a thing', () => {
    // `textContent` is derived — a projection of a composition's text for search. A collection
    // somebody named shows that name; only one nobody named falls back to what it says.
    expect(
      nameFromProperties([
        { name: 'textContent', type: 'string' },
        { name: 'title', type: 'string' },
      ]),
    ).toBe('title');
  });
});
