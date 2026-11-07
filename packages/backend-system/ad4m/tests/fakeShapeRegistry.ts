/**
 * A perspective that holds a shape registry the way the executor answers it: `registerShapes`
 * compares each shape with the one stored for its class and writes only a changed one, and
 * `shapes(names?)` reads the records back, sorted by name. Links are held beside it for WE's own
 * marker links. Nothing else is answered, so a read through a removed method fails.
 */
import { SHACLShape } from '@coasys/ad4m';
import { classNameOf } from '@we/backend-ad4m';

type StoredLink = { source: string; predicate: string; target: string };

export function fakeShapeRegistry() {
  const registry = new Map<string, SHACLShape>();
  const links: StoredLink[] = [];
  const calls = { registerShapes: [] as string[][], written: [] as string[][], shapes: [] as (string[] | undefined)[] };
  const copy = (shape: SHACLShape) => SHACLShape.fromJSON(JSON.parse(JSON.stringify(shape.toJSON())));

  const perspective = {
    uuid: 'p-registry',
    async registerShapes(shapes: SHACLShape[]) {
      const names = shapes.map((shape) => classNameOf(shape.targetClass ?? ''));
      if (new Set(names).size !== names.length) throw new Error('two shapes for one class in one call');
      calls.registerShapes.push(names);
      const written: string[] = [];
      const unchanged: string[] = [];
      shapes.forEach((shape, i) => {
        const before = registry.get(names[i]);
        if (before && before.targetClass !== shape.targetClass) {
          throw new Error(`class name ${names[i]} is already used by ${before.targetClass}`);
        }
        if (before && JSON.stringify(before.toJSON()) === JSON.stringify(shape.toJSON())) {
          unchanged.push(names[i]);
        } else {
          registry.set(names[i], copy(shape));
          written.push(names[i]);
        }
      });
      calls.written.push(written);
      return { unchanged, written, generation: calls.registerShapes.length };
    },
    async shapes(names?: string[]) {
      calls.shapes.push(names);
      return [...registry.entries()]
        .filter(([name]) => !names || names.includes(name))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, shape]) => ({ name, shape: copy(shape), hash: '' }));
    },
    async get(query: { source?: string; predicate?: string }) {
      return links
        .filter(
          (l) => (!query.source || l.source === query.source) && (!query.predicate || l.predicate === query.predicate),
        )
        .map((data) => ({ data }));
    },
    async add(link: StoredLink | { data: StoredLink }) {
      links.push('data' in link ? link.data : { source: link.source, predicate: link.predicate, target: link.target });
    },
    async removeLinks(removed: { data: StoredLink }[]) {
      for (const { data } of removed) {
        const at = links.findIndex(
          (l) => l.source === data.source && l.predicate === data.predicate && l.target === data.target,
        );
        if (at !== -1) links.splice(at, 1);
      }
    },
  };

  return { perspective, proxy: perspective as never, registry, links, calls };
}
