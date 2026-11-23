/**
 * A perspective that holds a shape registry the way the executor answers it (`register_shapes` and
 * `shapes` in ad4m's `rust-executor/src/perspectives/perspective_instance/shapes.rs`):
 *
 * - each shape is the class of its **target class IRI**, so two classes may share a name
 *   (`we://topic` and `flux://Topic` are both `Topic`);
 * - `registerShapes` compares each shape with the one stored for its class and writes only a changed
 *   one, and answers `written`/`unchanged` by target class IRI, sorted (two classes may share a name);
 * - it refuses a whole call, writing nothing from it, when two shapes in it are for one target class,
 *   two share a shape URI, a shape's URI is held by another class, or a given `nodeShapeUri` does not
 *   end in `{Class}Shape` — each refusal answered as a 400, which is how the executor's
 *   `perspective.registerShapes` handler reports every error the call returns
 *   (`WsRpcError::bad_request`);
 * - `shapes(keys?)` answers the classes whose name or target class is in `keys`, sorted by name and
 *   then by target class.
 *
 * Links are held beside it for WE's own marker links. Nothing else is answered, so a read through a
 * removed method fails.
 */
import { SHACLShape } from '@coasys/ad4m';
import { classNameOf } from '@we/backend-ad4m';

type StoredLink = { source: string; predicate: string; target: string };

/** The shape URI the executor stores a shape under: its own, or `<targetClass>Shape`. */
const shapeUriOf = (shape: SHACLShape) => shape.nodeShapeUri || `${shape.targetClass ?? ''}Shape`;

/**
 * A refusal, answered the way the executor answers one: an error reply carrying status 400.
 * Transport failures — a timeout, a dropped socket — carry 408 or 503, which is how the port tells
 * "the batch was refused" from "what happened to it is unknown".
 */
const refuse = (message: string): never => {
  throw Object.assign(new Error(message), { status: 400 });
};

export function fakeShapeRegistry() {
  /** Target class IRI → its stored shape. */
  const registry = new Map<string, SHACLShape>();
  const links: StoredLink[] = [];
  const calls = {
    /** Each call's classes, by name. */
    registerShapes: [] as string[][],
    /** Each call's classes, by target class. */
    registerTargets: [] as string[][],
    /** Each call's `written`, by target class IRI. */
    written: [] as string[][],
    shapes: [] as (string[] | undefined)[],
  };
  const copy = (shape: SHACLShape) => SHACLShape.fromJSON(JSON.parse(JSON.stringify(shape.toJSON())));

  const perspective = {
    uuid: 'p-registry',
    async registerShapes(shapes: SHACLShape[]) {
      const targets = shapes.map((shape) => shape.targetClass ?? '');
      const names = targets.map(classNameOf);
      calls.registerShapes.push(names);
      calls.registerTargets.push(targets);
      // Every refusal is decided before anything is written, as the executor does.
      if (new Set(targets).size !== targets.length) refuse('Two shapes for one class in one call');
      const uris = shapes.map(shapeUriOf);
      if (new Set(uris).size !== uris.length) refuse('Two classes in one call share a shape URI');
      shapes.forEach((shape, i) => {
        // A given shape URI keeps the `{ClassName}Shape` form of the default — the encoder's rule
        // (`shacl_parser::shape_links`). An omitted one mints it, which is always valid.
        if (shape.nodeShapeUri && !shape.nodeShapeUri.endsWith(`${names[i]}Shape`))
          refuse(`node_shape_uri '${shape.nodeShapeUri}' must end with '${names[i]}Shape'`);
        for (const [held, stored] of registry) {
          if (held !== targets[i] && shapeUriOf(stored) === uris[i]) {
            refuse(`Shape '${uris[i]}' already belongs to class '${held}'`);
          }
        }
      });
      const written: string[] = [];
      const unchanged: string[] = [];
      shapes.forEach((shape, i) => {
        const before = registry.get(targets[i]);
        if (before && JSON.stringify(before.toJSON()) === JSON.stringify(shape.toJSON())) {
          unchanged.push(targets[i]);
        } else {
          registry.set(targets[i], copy(shape));
          written.push(targets[i]);
        }
      });
      written.sort();
      unchanged.sort();
      calls.written.push(written);
      return { unchanged, written, generation: calls.registerShapes.length };
    },
    async shapes(keys?: string[]) {
      calls.shapes.push(keys);
      return [...registry.entries()]
        .map(([targetClass, shape]) => ({ name: classNameOf(targetClass), targetClass, shape }))
        .filter(({ name, targetClass }) => !keys || keys.includes(name) || keys.includes(targetClass))
        .sort((a, b) => a.name.localeCompare(b.name) || a.targetClass.localeCompare(b.targetClass))
        .map(({ name, shape }) => ({ name, shape: copy(shape), hash: '' }));
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
