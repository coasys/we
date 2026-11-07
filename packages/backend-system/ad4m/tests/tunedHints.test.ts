/**
 * A space's tuned interpretation hints outlive registration.
 *
 * The executor counts `ad4m://interpretation_hint` as part of a shape, so registering the declared
 * shape would put the declared hints back over the ones a space tuned. Structure stays code-owned:
 * every registration sends the model's structure. Hints become space-owned once a space marks the
 * shape tuned, and registration then sends the stored hints in the declared structure.
 */
import { SHACLShape } from '@coasys/ad4m';
import {
  classNameOf,
  HINTS_CUSTOMIZED_PREDICATE,
  installModuleSdna,
  installSpaceSdna,
  readInterpretationHints,
  refreshSpaceSdna,
  registerEntity,
  resetInterpretationHints,
  unregisterEntity,
  withTunedHints,
  writeInterpretationHints,
} from '@we/backend-ad4m';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TaskBlock } from '../src/entities';
import { fakeShapeRegistry } from './fakeShapeRegistry';

const declared = () => SHACLShape.fromJSON((TaskBlock.generateSHACL() as { shape: SHACLShape }).shape.toJSON());
const hintOf = (shape: SHACLShape, name: string) => shape.properties.find((p) => p.name === name)?.interpretationHint;

describe('classNameOf', () => {
  it.each([
    ['we://TaskBlock', 'TaskBlock'],
    ['flux://Message', 'Message'],
    ['https://example.org/ns#Recipe', 'Recipe'],
    ['https://example.org/things/Recipe', 'Recipe'],
    ['urn:Thing', 'Thing'],
    ['Plain', 'Plain'],
  ])('names %s as %s', (targetClass, name) => {
    expect(classNameOf(targetClass)).toBe(name);
  });
});

describe('withTunedHints', () => {
  it('keeps the declared structure and takes the stored hints', () => {
    const stored = declared();
    stored.interpretationHint = 'tuned class hint';
    stored.properties.find((p) => p.name === 'status')!.interpretationHint = 'tuned status hint';
    const next = declared();
    next.properties = next.properties.filter((p) => p.name !== 'description');

    const merged = withTunedHints(next, stored);

    expect(merged.properties.map((p) => p.name)).toEqual(next.properties.map((p) => p.name));
    expect(merged.interpretationHint).toBe('tuned class hint');
    expect(hintOf(merged, 'status')).toBe('tuned status hint');
  });

  it('removes a hint the space removed', () => {
    const stored = declared();
    delete stored.interpretationHint;
    delete stored.properties.find((p) => p.name === 'status')!.interpretationHint;

    const merged = withTunedHints(declared(), stored);

    expect(merged.interpretationHint).toBeUndefined();
    expect(hintOf(merged, 'status')).toBeUndefined();
  });

  it('keeps the declared hint of a property the stored shape does not have', () => {
    const stored = declared();
    stored.properties = stored.properties.filter((p) => p.name !== 'status');

    expect(hintOf(withTunedHints(declared(), stored), 'status')).toBe(hintOf(declared(), 'status'));
  });

  it('does not change the declared shape it was given', () => {
    const before = JSON.stringify(declared().toJSON());
    const shape = declared();
    const stored = declared();
    stored.interpretationHint = 'tuned';

    withTunedHints(shape, stored);

    expect(JSON.stringify(shape.toJSON())).toBe(before);
  });
});

describe('tuned hints through registration', () => {
  beforeEach(() => registerEntity('TaskBlock', TaskBlock as never));
  afterEach(() => unregisterEntity('TaskBlock'));

  it('reads the declared hints, not customized, after a plain install', async () => {
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy, [TaskBlock]);

    const hints = await readInterpretationHints(r.proxy, 'TaskBlock');

    expect(hints?.customized).toBe(false);
    expect(hints?.classHint).toBe(declared().interpretationHint);
    expect(hints?.propHints.status).toBe(hintOf(declared(), 'status'));
  });

  it('reads nothing for an entity with no stored shape', async () => {
    expect(await readInterpretationHints(fakeShapeRegistry().proxy, 'TaskBlock')).toBeNull();
  });

  it('refuses to tune an entity with no stored shape', async () => {
    await expect(writeInterpretationHints(fakeShapeRegistry().proxy, 'TaskBlock', { classHint: 'x' })).rejects.toThrow(
      'no stored shape',
    );
  });

  it('writes the tuned hints, marks the shape, and keeps them through the next switch', async () => {
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy, [TaskBlock]);

    await writeInterpretationHints(r.proxy, 'TaskBlock', { classHint: 'tuned', propHints: { status: 'tuned status' } });
    await installSpaceSdna(r.proxy, [TaskBlock]);
    await refreshSpaceSdna(r.proxy);

    const hints = await readInterpretationHints(r.proxy, 'TaskBlock');
    expect(hints?.customized).toBe(true);
    expect(hints?.classHint).toBe('tuned');
    expect(hints?.propHints.status).toBe('tuned status');
    expect(r.links.filter((l) => l.predicate === HINTS_CUSTOMIZED_PREDICATE)).toHaveLength(1);
  });

  it('sends the tuned shape unchanged on the next switch, so nothing is written', async () => {
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy, [TaskBlock]);
    await writeInterpretationHints(r.proxy, 'TaskBlock', { classHint: 'tuned' });

    await installModuleSdna(r.proxy, [TaskBlock]);

    expect(r.calls.shapes.at(-1)).toEqual(['TaskBlock']);
    expect(r.calls.written.at(-1)).toEqual([]);
  });

  it('removes a hint for an empty string', async () => {
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy, [TaskBlock]);

    await writeInterpretationHints(r.proxy, 'TaskBlock', { propHints: { status: '' } });

    expect((await readInterpretationHints(r.proxy, 'TaskBlock'))?.propHints.status).toBeUndefined();
  });

  it('refuses a property the stored shape does not have', async () => {
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy, [TaskBlock]);

    await expect(writeInterpretationHints(r.proxy, 'TaskBlock', { propHints: { nope: 'x' } })).rejects.toThrow(
      'no stored property called nope',
    );
  });

  it('resets to the declared hints and removes the marker', async () => {
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy, [TaskBlock]);
    await writeInterpretationHints(r.proxy, 'TaskBlock', { classHint: 'tuned' });

    await resetInterpretationHints(r.proxy, 'TaskBlock');

    const hints = await readInterpretationHints(r.proxy, 'TaskBlock');
    expect(hints?.customized).toBe(false);
    expect(hints?.classHint).toBe(declared().interpretationHint);
    expect(r.links.filter((l) => l.predicate === HINTS_CUSTOMIZED_PREDICATE)).toEqual([]);
  });
});
