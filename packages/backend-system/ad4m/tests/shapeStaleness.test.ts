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
 *
 * ## Why the declared side is a stub
 *
 * `declaredShape` reads whatever `generateSHACL()` emits, and a runtime that does not know
 * `interpretationHint` / `identity` drops them — so driving these from the real `TaskBlock` made
 * every case here an assertion about the *runtime's* decorator support rather than about the
 * comparison. On a published build the declared side came back with no hints at all, "a hint
 * appearing where there was none" compared undefined against undefined, and six tests failed
 * without the comparison having changed.
 *
 * The unit under test is the diff. So the declared side is a fixture, and the two assertions that
 * genuinely are about the runtime are marked as such below.
 */
import { declaredShape, shapeIsStale, type StoredShape } from '@we/backend-ad4m';
import { TaskBlock } from '@we/models/classes';
import { describe, expect, it } from 'vitest';

const TARGET = 'we://TaskBlock';

/**
 * A model, as far as `declaredShape` is concerned — it asks for `generateSHACL()` and nothing else.
 *
 * Shaped like `TaskBlock`'s, because that is the class the regressions happened on.
 */
const MODEL = {
  generateSHACL: () => ({
    shape: {
      // Everything the module reads comes off this one object, `targetClass` included — it is the
      // key the stored map is looked up by, and without it `shapeIsStale` reads the class as one the
      // perspective does not have and returns "not stale" for every case.
      targetClass: TARGET,
      interpretationHint: 'a piece of work somebody needs doing',
      properties: [
        { path: 'we://title', name: 'title', identity: true, interpretationHint: 'imperative, short' },
        { path: 'we://description', name: 'description' },
        { path: 'we://due_date', name: 'dueDate', interpretationHint: 'when it is due' },
      ],
    },
  }),
};

/** The stored side, as it looks when it exactly matches the model. */
function current(): StoredShape {
  const declared = declaredShape(MODEL as never);
  return {
    paths: new Set(declared.paths),
    classHint: declared.classHint,
    identityPath: declared.identityPath,
    propHints: new Map(declared.propHints),
  };
}

const storedAs = (shape: StoredShape) => new Map([[TARGET, shape]]);
const isStale = (shape: StoredShape) => shapeIsStale(MODEL as never, storedAs(shape));

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

  describe('space-owned hints (the customized marker)', () => {
    // The yield rule: once a space customizes an entity's hints, a stored hint that differs from
    // the declaration is the community's tuning, not staleness — reverting it on every space
    // switch would silently erase their work. Structure stays code-owned regardless.

    it('yields on a reworded class hint when the space customized it', () => {
      expect(isStale({ ...current(), classHint: 'the community tuned this', hintsCustomized: true })).toBe(false);
    });

    it('yields on a customized property hint', () => {
      const shape = current();
      shape.propHints.set('we://title', 'the community tuned this');
      shape.hintsCustomized = true;
      expect(isStale(shape)).toBe(false);
    });

    it('yields on a hint the space removed entirely', () => {
      const shape = current();
      shape.propHints.delete('we://title');
      shape.hintsCustomized = true;
      expect(isStale(shape)).toBe(false);
    });

    it('still catches a gained property on a hint-customized shape', () => {
      const shape = current();
      shape.paths.delete('we://due_date');
      shape.hintsCustomized = true;
      expect(isStale(shape)).toBe(true);
    });

    it('still catches identity changes on a hint-customized shape', () => {
      // Identity is the dedup key — structural, not prompt tuning. Yielding on it would let a
      // release's dedup fix silently never arrive in any space that ever touched a hint.
      expect(isStale({ ...current(), identityPath: undefined, hintsCustomized: true })).toBe(true);
    });
  });
});

describe('declaredShape against the real models', () => {
  /*
    These two are about the *runtime*, not about this package: they assert that the options
    `TaskBlock` declares survive into the generated SHACL, which only a build that knows
    `interpretationHint` and `identity` will do. Against one that does not, the decorators pass them
    through and they are dropped — extraction then finds nothing, which is the documented state until
    the interpretation stack is published.

    Skipped rather than deleted, and skipped on a probe rather than a version check, so they start
    running again the moment the runtime supports them without anybody remembering to re-enable them.
  */
  const emitted = (
    TaskBlock as unknown as { generateSHACL: () => { shape: { interpretationHint?: string } } }
  ).generateSHACL().shape.interpretationHint;
  const runtimeKeepsHints = typeof emitted === 'string' && emitted.length > 0;

  it.skipIf(!runtimeKeepsHints)('reads the identity property the extraction path depends on', () => {
    expect(declaredShape(TaskBlock as never).identityPath).toBe('we://title');
  });

  it.skipIf(!runtimeKeepsHints)('reads class and property hints', () => {
    const declared = declaredShape(TaskBlock as never);
    expect(declared.classHint).toContain('needs doing');
    expect(declared.propHints.get('we://title')).toContain('imperative');
  });
});
