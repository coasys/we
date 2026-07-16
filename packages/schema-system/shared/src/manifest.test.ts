import { describe, expect, it } from 'vitest';

import { getProperty, getRelation, validateManifest, type ModelManifest } from './manifest';

// A hand-authored manifest for a domain that is NOT WE's (a library) — proving the format is
// backend- and domain-neutral, i.e. it serves third parties describing their own entities.
const library: ModelManifest = {
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

describe('ModelManifest', () => {
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
    const bad: ModelManifest = {
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
    const bad: ModelManifest = {
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
});
