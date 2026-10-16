/**
 * A relation named the way the contract names it, translated to the predicate this backend stores it
 * under — and refused, saying what to add, wherever the name does not decide.
 */
import { CONTAINMENT_PREDICATE } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { AD4M_CONTAINMENT_PREDICATE } from '../src/containment';
import { installParentByRelation } from '../src/parentByRelation';
import {
  parentPredicate,
  predicateOfRelation,
  registerDeclaredRelations,
  relationOfPredicate,
} from '../src/relationPredicates';

describe('a relation by name', () => {
  it('resolves one WeNode declares to the same predicate on every record', () => {
    expect(predicateOfRelation('signals')).toBe('we://signal');
    expect(predicateOfRelation('responses')).toBe('we://response');
  });

  it("resolves a collection's children to containment, as AD4M stores it", () => {
    expect(predicateOfRelation('children', 'CollectionBlock')).toBe(AD4M_CONTAINMENT_PREDICATE);
  });

  it('reads containment back to its relation under either spelling', () => {
    expect(relationOfPredicate(AD4M_CONTAINMENT_PREDICATE, ['CollectionBlock'])).toBe('children');
    expect(relationOfPredicate(CONTAINMENT_PREDICATE, ['CollectionBlock'])).toBe('children');
  });

  it('resolves an inherited relation on the entity named', () => {
    expect(predicateOfRelation('signals', 'Space')).toBe('we://signal');
  });

  it('refuses a name no entity declares', () => {
    expect(() => predicateOfRelation('nothingLikeThis')).toThrow(/no record WE declares/);
  });

  it('refuses a relation read backwards, which nothing can be written through', () => {
    expect(() => predicateOfRelation('respondsTo', 'TaskBlock')).toThrow(/read backwards/);
  });

  it('takes a declared relation once its manifest is registered', () => {
    expect(() => predicateOfRelation('pages', 'Notebook')).toThrow();
    registerDeclaredRelations([
      { name: 'Notebook', properties: [{ name: 'pages', predicate: 'we://module/test/pages' }] } as never,
    ]);
    expect(predicateOfRelation('pages', 'Notebook')).toBe('we://module/test/pages');
    expect(predicateOfRelation('pages')).toBe('we://module/test/pages');
  });

  it('refuses a name two entities store differently, unless the entity is named', () => {
    registerDeclaredRelations([
      { name: 'Binder', properties: [{ name: 'children', predicate: 'we://module/test/binder' }] } as never,
    ]);
    expect(() => predicateOfRelation('children')).toThrow(/name the entity/);
    expect(predicateOfRelation('children', 'Binder')).toBe('we://module/test/binder');
  });

  it('reads a predicate back to its name', () => {
    expect(relationOfPredicate('we://signal')).toBe('signals');
    expect(relationOfPredicate('we://not-a-relation')).toBeUndefined();
  });

  it('makes the parent the model layer takes', () => {
    expect(parentPredicate({ id: 'p1', relation: 'responses' })).toEqual({ id: 'p1', predicate: 'we://response' });
  });
});

describe('a parent by relation, on the model layer', () => {
  function fakeModel() {
    const seen: Record<string, unknown[]> = {};
    const model = {
      create: (...args: unknown[]) => (seen.create = args),
      findAll: (...args: unknown[]) => (seen.findAll = args),
      paginate: (...args: unknown[]) => (seen.paginate = args),
      findAllOf: (...args: unknown[]) => (seen.findAllOf = args),
      queryOf: (...args: unknown[]) => (seen.queryOf = args),
    };
    return { model, seen };
  }

  it('translates the parent each static takes, wherever it sits in the arguments', () => {
    const { model, seen } = fakeModel();
    installParentByRelation(model as never);
    model.create('dataset', { value: 1 }, { parent: { id: 'n1', relation: 'signals' }, batchId: 'b' });
    model.findAll('dataset', { parent: { id: 'c1', relation: 'children', entity: 'CollectionBlock' } });
    model.paginate('dataset', 10, 1, { parent: { id: 'n1', relation: 'responses' } });

    expect(seen.create[2]).toEqual({ parent: { id: 'n1', predicate: 'we://signal' }, batchId: 'b' });
    expect(seen.findAll[1]).toEqual({ parent: { id: 'c1', predicate: AD4M_CONTAINMENT_PREDICATE } });
    expect(seen.paginate[3]).toEqual({ parent: { id: 'n1', predicate: 'we://response' } });
  });

  it('translates the parent of a read over several classes, which takes the classes second', () => {
    const { model, seen } = fakeModel();
    installParentByRelation(model as never);
    model.findAllOf('dataset', ['TaskBlock'], {
      parent: { id: 'c1', relation: 'children', entity: 'CollectionBlock' },
    });
    model.queryOf('dataset', ['TaskBlock'], {
      parent: { id: 'c1', relation: 'children', entity: 'CollectionBlock' },
      limit: 10,
    });

    expect(seen.findAllOf[2]).toEqual({ parent: { id: 'c1', predicate: AD4M_CONTAINMENT_PREDICATE } });
    expect(seen.queryOf[2]).toEqual({ parent: { id: 'c1', predicate: AD4M_CONTAINMENT_PREDICATE }, limit: 10 });
  });

  it("passes a predicate-named parent through — this package's own drill-downs build those", () => {
    const { model, seen } = fakeModel();
    installParentByRelation(model as never);
    model.findAll('dataset', { parent: { id: 'c1', predicate: 'we://anything' } });
    expect(seen.findAll[1]).toEqual({ parent: { id: 'c1', predicate: 'we://anything' } });
  });

  it('installs once, however many times the adapter is built', () => {
    const { model, seen } = fakeModel();
    installParentByRelation(model as never);
    installParentByRelation(model as never);
    model.create('dataset', {}, { parent: { id: 'n1', relation: 'signals' } });
    expect(seen.create[2]).toEqual({ parent: { id: 'n1', predicate: 'we://signal' } });
  });
});
