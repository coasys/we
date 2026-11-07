/**
 * The polls module in a space that began as a Flux community.
 *
 * Flux has a `Poll` and a `Vote` of its own (`flux://Poll`, `flux://Vote`). The polls module declares
 * classes of the same names. The executor addresses a class by its target class IRI, so the module's
 * classes register beside Flux's: nothing is refused, and Flux's classes are not changed.
 *
 * The registry below does what the executor's `register_shapes` does with a call: it keys classes by
 * target class, refuses a shape URI another class holds, and answers `shapes(keys)` by name or by
 * target class.
 */
import { SHACLShape } from '@coasys/ad4m';
import { createAd4mSchemaPort, getEntityTargetClass, installModuleSdna } from '@we/backend-ad4m';
import { pollsModule } from '@we/module-polls';
import { afterEach, describe, expect, it } from 'vitest';

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

function shapeRegistry() {
  const registry = new Map<string, SHACLShape>();
  const proxy = {
    get: async () => [],
    async registerShapes(shapes: SHACLShape[]) {
      for (const shape of shapes) {
        const uri = shape.nodeShapeUri ?? `${shape.targetClass}Shape`;
        for (const [other, held] of registry) {
          if (other !== shape.targetClass && (held.nodeShapeUri ?? `${other}Shape`) === uri) {
            throw new Error(`Shape '${uri}' already belongs to class '${other}'`);
          }
        }
      }
      for (const shape of shapes) registry.set(shape.targetClass!, shape);
      // By target class IRI, as the executor answers (two classes may share a name).
      return { written: shapes.map((s) => s.targetClass!).sort(), unchanged: [] };
    },
    async shapes(keys?: string[]) {
      return [...registry.entries()]
        .filter(([targetClass]) => !keys || keys.includes(targetClass) || keys.includes(nameOf(targetClass)))
        .map(([targetClass, shape]) => ({ name: nameOf(targetClass), shape }));
    },
  };
  return { registry, proxy };
}

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

    const r = shapeRegistry();
    const fluxPoll = flux(byName.Poll, 'Poll');
    const fluxVote = flux(byName.Vote, 'Vote');
    await r.proxy.registerShapes([fluxPoll, fluxVote]);

    await installModuleSdna(r.proxy as never, models);

    const ours = [getEntityTargetClass(byName.Poll as never)!, getEntityTargetClass(byName.Vote as never)!];
    expect(ours.some((iri) => iri.startsWith('flux://'))).toBe(false);
    expect([...r.registry.keys()].sort()).toEqual(['flux://Poll', 'flux://Vote', ...ours].sort());
    expect(r.registry.get('flux://Poll')).toBe(fluxPoll);
    expect(r.registry.get('flux://Vote')).toBe(fluxVote);
    // Asked by name, both apps' polls answer; asked by IRI, only the one.
    expect(await r.proxy.shapes(['Poll'])).toHaveLength(2);
    expect((await r.proxy.shapes([ours[0]])).map((s) => s.shape.targetClass)).toEqual([ours[0]]);
  });
});
