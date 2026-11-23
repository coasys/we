/**
 * The polls module in a space that began as a Flux community.
 *
 * Flux has a `Poll` and a `Vote` of its own (`flux://Poll`, `flux://Vote`). The polls module declares
 * classes of the same names. The executor addresses a class by its target class IRI, so the module's
 * classes register beside Flux's: nothing is refused, and Flux's classes are not changed.
 *
 * The registry is the shared fake (`fakeShapeRegistry`), which registers a call the way the
 * executor's `register_shapes` does — a call naming one class twice or two classes one shape URI is
 * refused whole, never silently overwritten.
 */
import { SHACLShape } from '@coasys/ad4m';
import { createAd4mSchemaPort, getEntityTargetClass, installModuleSdna } from '@we/backend-ad4m';
import { pollsModule } from '@we/module-polls';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeShapeRegistry } from '../../backend-system/ad4m/tests/fakeShapeRegistry';
import { createModuleStoreDeps } from '../src/shared/registries/moduleHostServices';
import { moduleRegistry } from '../src/shared/registries/moduleRegistry';

const host = { backend: 'ad4m', framework: 'solid' };
const storeDeps = createModuleStoreDeps({
  signal: <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => void (value = next)];
  },
  effect: (fn) => fn(),
});

type Model = { generateSHACL(): { shape: SHACLShape } };
const shapeOf = (model: unknown) => SHACLShape.fromJSON((model as Model).generateSHACL().shape.toJSON());
const nameOf = (targetClass: string) => targetClass.slice(targetClass.lastIndexOf('/') + 1);

/** Flux's class of one name: the polls module's shape, in Flux's namespace. */
function flux(model: unknown, name: string): SHACLShape {
  const shape = shapeOf(model);
  shape.targetClass = `flux://${name}`;
  shape.nodeShapeUri = `flux://${name}Shape`;
  return shape;
}

afterEach(() => moduleRegistry.unregister('polls'));

describe('the polls module beside Flux’s Poll and Vote', () => {
  it('registers its classes, and leaves Flux’s as they were', async () => {
    moduleRegistry.register(pollsModule, host, storeDeps);
    const models = moduleRegistry.moduleSchemas(createAd4mSchemaPort({}));
    const byName = Object.fromEntries(models.map((m) => [nameOf(getEntityTargetClass(m as never)!), m]));
    expect(Object.keys(byName).sort()).toEqual(['Poll', 'Vote']);

    const r = fakeShapeRegistry();
    const fluxPoll = flux(byName.Poll, 'Poll');
    const fluxVote = flux(byName.Vote, 'Vote');
    await r.perspective.registerShapes([fluxPoll, fluxVote]);

    await installModuleSdna(r.proxy, models);

    const ours = [getEntityTargetClass(byName.Poll as never)!, getEntityTargetClass(byName.Vote as never)!];
    expect(ours.some((iri) => iri.startsWith('flux://'))).toBe(false);
    // One call, both classes in it, each exactly once — a call naming a class twice is refused whole.
    expect(r.calls.registerTargets).toHaveLength(2);
    const submitted = r.calls.registerTargets[1];
    expect(submitted).toHaveLength(2);
    expect([...submitted].sort()).toEqual([...ours].sort());
    expect([...r.registry.keys()].sort()).toEqual(['flux://Poll', 'flux://Vote', ...ours].sort());
    // The fake stores copies; the shapes themselves are what compare.
    expect(r.registry.get('flux://Poll')?.toJSON()).toEqual(fluxPoll.toJSON());
    expect(r.registry.get('flux://Vote')?.toJSON()).toEqual(fluxVote.toJSON());
    // Asked by name, both apps' polls answer; asked by IRI, only the one.
    expect(await r.perspective.shapes(['Poll'])).toHaveLength(2);
    expect((await r.perspective.shapes([ours[0]])).map((s) => s.shape.targetClass)).toEqual([ours[0]]);
  });
});
