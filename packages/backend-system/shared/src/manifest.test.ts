import { describe, expect, it } from 'vitest';

import { type EntityManifest, getProperty, getRelation, resolvesPolymorphically, validateManifest } from './manifest';

// A hand-authored manifest for a domain that is NOT WE's (a library) — proving the format is
// backend- and domain-neutral, i.e. it serves third parties describing their own entities.
const library: EntityManifest = {
  version: '1',
  entities: {
    Book: {
      properties: {
        title: { type: 'string', required: true },
        publishedAt: { type: 'datetime' },
        pageCount: { type: 'number' },
      },
      relations: {
        author: { target: 'Author', cardinality: 'one', reverseOf: 'books' },
        tags: { target: 'Tag', cardinality: 'many' },
      },
    },
    Author: {
      properties: { name: { type: 'string', required: true } },
      relations: { books: { target: 'Book', cardinality: 'many', reverseOf: 'author' } },
    },
    Tag: {
      properties: { label: { type: 'string', required: true } },
      relations: {},
    },
  },
};

describe('EntityManifest', () => {
  it('validates a well-formed, non-WE manifest', () => {
    const result = validateManifest(library);
    expect(result.valid).toBe(true);
    if (result.valid) expect(Object.keys(result.manifest.entities)).toEqual(['Book', 'Author', 'Tag']);
  });

  it('rejects a structurally invalid manifest (bad scalar type)', () => {
    const bad = { version: '1', entities: { X: { properties: { n: { type: 'int' } }, relations: {} } } };
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0].path).toContain('X.properties.n.type');
  });

  it('rejects a relation pointing at an unknown entity', () => {
    const bad: EntityManifest = {
      version: '1',
      entities: { Book: { properties: {}, relations: { author: { target: 'Ghost', cardinality: 'one' } } } },
    };
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        path: 'entities.Book.relations.author.target',
        message: 'unknown target entity "Ghost"',
      });
    }
  });

  it('rejects a reverseOf that is not a relation on the target', () => {
    const bad: EntityManifest = {
      version: '1',
      entities: {
        Book: { properties: {}, relations: { author: { target: 'Author', cardinality: 'one', reverseOf: 'nope' } } },
        Author: { properties: {}, relations: {} },
      },
    };
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0].message).toContain('"nope" is not a relation on "Author"');
  });

  it('lookup helpers resolve properties and relations (what the IR compiler needs)', () => {
    expect(getProperty(library, 'Book', 'title')).toEqual({ type: 'string', required: true });
    expect(getRelation(library, 'Book', 'author')).toEqual({
      target: 'Author',
      cardinality: 'one',
      reverseOf: 'books',
    });
    expect(getRelation(library, 'Book', 'missing')).toBeUndefined();
  });

  describe('ordered and polymorphic relations', () => {
    it('accepts an ordered untyped collection — the shape the field exists for', () => {
      // A collection's children name no target class and are still in the order somebody dragged
      // them into, so the two halves have to be declarable together.
      const result = validateManifest({
        version: '1',
        entities: {
          Collection: { properties: {}, relations: { children: { target: '', cardinality: 'many', ordered: true } } },
        },
      });
      expect(result.valid).toBe(true);
    });

    it('rejects ordered on a relation holding one record', () => {
      const result = validateManifest({
        version: '1',
        entities: {
          Book: { properties: {}, relations: { author: { target: 'Author', cardinality: 'one', ordered: true } } },
          Author: { properties: {}, relations: {} },
        },
      });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors[0].message).toContain('no order to declare');
    });

    it('treats an untyped relation as polymorphic without being told', () => {
      // The default is not a convenience: with no target there is no shape to hydrate against, so
      // the alternative to reading each member as its own class is a failed read, not a cheaper one.
      expect(resolvesPolymorphically({ target: '', cardinality: 'many' })).toBe(true);
    });

    it('leaves a typed relation alone unless it says otherwise', () => {
      expect(resolvesPolymorphically({ target: 'Author', cardinality: 'one' })).toBe(false);
      // A relation naming a base class is the case that must declare it — nothing about the target
      // says whether the members are plain nodes or a mix of subclasses.
      expect(resolvesPolymorphically({ target: 'WeNode', cardinality: 'many', polymorphic: true })).toBe(true);
    });

    it('lets an untyped relation opt out explicitly', () => {
      expect(resolvesPolymorphically({ target: '', cardinality: 'many', polymorphic: false })).toBe(false);
    });
  });
});
