/**
 * Whether a stored shape is behind the model that declares it.
 *
 * Every case here is a regression. The check began as "does the stored shape have every predicate",
 * and each thing it did *not* compare turned into a change that silently never reached a space —
 * with a symptom somewhere else entirely, never "your schema is stale":
 *
 *   - an interpretation hint added → the model was prompted with bare predicate names
 *   - a hint *reworded* → the space kept prompting with the original wording, so extraction returned
 *     nothing and read as a prompt that needed tuning
 *   - `identity` set on a property → the class stayed invisible to dedup, so every pass minted
 *     duplicates
 *
 * None of those change a `sh://path`, which is why the predicate diff missed all three.
 */
import { declaredShape, shapeIsStale, type StoredShape } from '@we/backend-ad4m';
import { TaskBlock } from '@we/models/classes';
import { describe, expect, it } from 'vitest';

const TARGET = 'we://TaskBlock';

/** The stored side, as it looks when it exactly matches the model. */
function current(): StoredShape {
  const declared = declaredShape(TaskBlock as never);
  return {
    paths: new Set(declared.paths),
    classHint: declared.classHint,
    identityPath: declared.identityPath,
    propHints: new Map(declared.propHints),
  };
}

const storedAs = (shape: StoredShape) => new Map([[TARGET, shape]]);
const isStale = (shape: StoredShape) => shapeIsStale(TaskBlock as never, storedAs(shape));

describe('shapeIsStale', () => {
  it('leaves a shape alone when it already matches', () => {
    expect(isStale(current())).toBe(false);
  });

  it('treats a shape with no stored properties as fresh, not stale', () => {
    // Replication lag on a freshly-joined neighbourhood: the SubjectClass marker can arrive before
    // the shape triples. Reading that gap as "missing everything" would rewrite every shape in the
    // space on the strength of data that had simply not arrived.
    expect(isStale({ paths: new Set(), propHints: new Map() })).toBe(false);
  });

  it('catches a property the model has gained', () => {
    const shape = current();
    shape.paths.delete('we://due_date');
    expect(isStale(shape)).toBe(true);
  });

  it('catches a reworded class hint', () => {
    expect(isStale({ ...current(), classHint: 'something the model no longer says' })).toBe(true);
  });

  it('catches a class hint appearing where there was none', () => {
    expect(isStale({ ...current(), classHint: undefined })).toBe(true);
  });

  it('catches identity being set on a property', () => {
    // The one that made extraction duplicate everything: `identity` adds no `sh://path` and touches
    // no hint, so both earlier versions of this check passed it straight through.
    expect(isStale({ ...current(), identityPath: undefined })).toBe(true);
  });

  it('catches identity moving to a different property', () => {
    expect(isStale({ ...current(), identityPath: 'we://description' })).toBe(true);
  });

  it('catches a reworded property hint', () => {
    const shape = current();
    shape.propHints.set('we://title', 'an older wording');
    expect(isStale(shape)).toBe(true);
  });

  it('catches a property hint appearing where there was none', () => {
    const shape = current();
    shape.propHints.delete('we://title');
    expect(isStale(shape)).toBe(true);
  });

  it('ignores a class the perspective does not have stored at all', () => {
    // Absent entirely is `missing`, handled by the caller's `hasSubjectClassLink` pass — not stale.
    expect(shapeIsStale(TaskBlock as never, new Map())).toBe(false);
  });
});

describe('declaredShape', () => {
  it('reads the identity property the extraction path depends on', () => {
    expect(declaredShape(TaskBlock as never).identityPath).toBe('we://title');
  });

  it('reads class and property hints', () => {
    const declared = declaredShape(TaskBlock as never);
    expect(declared.classHint).toContain('needs doing');
    expect(declared.propHints.get('we://title')).toContain('imperative');
  });
});
