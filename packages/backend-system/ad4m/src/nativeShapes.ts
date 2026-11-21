/**
 * A space's own models, kept as the SHACL the executor already stores for them — and nothing else.
 *
 * Saving a model compiles its manifest into a class and installs its SHACL, the path every module
 * entity takes, then writes the annotation links that carry what SHACL cannot say (`shapeCodec.ts`).
 * Listing reads the two back into manifests: the structure from `shapes()`, the annotations from the
 * links on the shape's nodes. There is no second copy: when other software edits a model's shape, WE
 * reads the edit rather than overwriting it from a document of its own, and a shape holding more than
 * WE's manifest can say reads back as not editable, so a save from WE never drops it.
 *
 * ## Annotations survive an install
 *
 * The executor writes a registered class's own links and keeps every other link on its nodes, so
 * registering the class again — on a switch, or when a release changes it — leaves the annotations
 * where they are. Only a save writes them, diff-first, so a save with nothing to change writes nothing.
 *
 * ## Removing
 *
 * Takes away the annotations, so the space no longer lists the model as one of its own. The SHACL
 * stays: records of the model keep their type and remain readable as what they are.
 */
import { Link, LinkQuery, type PerspectiveProxy, type SHACLShape } from '@coasys/ad4m';
import type { DatasetHandle, EntityManifest, ShapeInput, ShapeStore, StoredShape } from '@we/backend-shared';

import { compileManifest } from './manifestCompiler';
import { ANNOTATION, annotationLinks, isAnnotation, linkKey, readShape, sameShape, shapeNodes } from './shapeCodec';

const proxy = (dataset: DatasetHandle) => dataset as PerspectiveProxy;

type Shaped = { generateSHACL: () => { shape: SHACLShape } };

export interface Ad4mShapeStoreDeps {
  /** Compile a manifest for one dataset, as `SchemaPort.declareInDataset` does. */
  declare: (dataset: DatasetHandle, manifest: EntityManifest, opts: { moduleId: string }) => Record<string, unknown>;
  /** Install one compiled class's SHACL, as `SchemaPort.ensure` does. */
  ensure: (dataset: DatasetHandle, cls: unknown) => Promise<void>;
  /**
   * The class a relation's target names in this dataset, as `declare` resolves it. A model is
   * installed with its relations to other models resolved, so a rebuild compared with what is stored
   * has to resolve them the same way, or every model linking to another reads as changed.
   */
  resolveExternal?: (dataset: DatasetHandle, name: string) => unknown;
}

/** The module id a model compiles under: its shape id without the scheme, as the host adopts it. */
const moduleIdOf = (shapeId: string) => `shape/${shapeId.replace('we://shapes/', '')}`;

/** The model's class, compiled once for its SHACL — with its relations' targets resolved by `resolve`, where given. */
function compiled(shape: ShapeInput, resolve: (name: string) => unknown = () => undefined): Shaped {
  const classes = compileManifest(shape.manifest, {
    moduleId: moduleIdOf(shape.shapeId),
    resolveExternal: (name) => resolve(name) as never,
  });
  const cls = classes[shape.name];
  if (!cls) throw new Error(`shapes: the manifest does not declare "${shape.name}"`);
  return cls;
}

/** Every link sourced at one of `nodes`, with the expression removing one needs. */
async function linksOn(perspective: PerspectiveProxy, nodes: readonly string[]) {
  const found = await Promise.all(nodes.map((source) => perspective.get(new LinkQuery({ source }))));
  return found.flat().map((expression) => ({ expression, link: expression.data }));
}

/** Every registered shape in the perspective, by its node shape. */
async function shapesByNode(perspective: PerspectiveProxy): Promise<Map<string, SHACLShape>> {
  const registered = await perspective.shapes();
  return new Map(registered.map(({ shape }) => [shape.nodeShapeUri, shape]));
}

/** Make a model's annotations say what `shape` says: add what is missing, remove what is stale. */
async function writeAnnotations(perspective: PerspectiveProxy, shape: ShapeInput): Promise<void> {
  const shacl = compiled(shape).generateSHACL().shape;
  const desired = annotationLinks(shape, shacl.toLinks());
  const desiredKeys = new Set(desired.map(linkKey));
  const stored = (await linksOn(perspective, shapeNodes(shacl))).filter(({ link }) => isAnnotation(link));
  const storedKeys = new Set(stored.map(({ link }) => linkKey(link)));
  const stale = stored.filter(({ link }) => !desiredKeys.has(linkKey(link)));
  const missing = desired.filter((l) => !storedKeys.has(linkKey(l)));
  if (stale.length) await perspective.removeLinks(stale.map(({ expression }) => expression));
  if (missing.length) await perspective.addLinks(missing.map((l) => new Link(l)));
}

export function createAd4mShapeStore(deps: Ad4mShapeStoreDeps): ShapeStore {
  async function install(dataset: DatasetHandle, shape: ShapeInput): Promise<string> {
    const classes = deps.declare(dataset, shape.manifest, { moduleId: moduleIdOf(shape.shapeId) });
    for (const cls of Object.values(classes)) await deps.ensure(dataset, cls);
    return compiled(shape).generateSHACL().shape.nodeShapeUri;
  }

  return {
    async list(dataset) {
      const perspective = proxy(dataset);
      const [marked, registered] = await Promise.all([
        perspective.get(new LinkQuery({ predicate: ANNOTATION.shapeId })),
        shapesByNode(perspective),
      ]);
      // A marked node with no registered shape is an annotation the class outlived: nothing to list.
      const shapeUris = [...new Set(marked.map((l) => l.data.source))].filter((uri) => registered.has(uri));
      const shapes = await Promise.all(
        shapeUris.map(async (shapeUri): Promise<StoredShape | null> => {
          const stored = registered.get(shapeUri)!;
          const held = { shape: stored, links: (await linksOn(perspective, shapeNodes(stored))).map((l) => l.link) };
          let read;
          try {
            read = readShape(held);
          } catch (error) {
            console.warn(`ad4m: the stored model at ${shapeUri} could not be read`, error);
            return null;
          }
          if (!read) return null;
          const { shapeUri: id, manifest, ...record } = read;
          let editable = false;
          try {
            const rebuilt = compiled({ ...record, manifest }, (name) =>
              deps.resolveExternal?.(dataset, name),
            ).generateSHACL().shape;
            editable = sameShape(held, {
              shape: rebuilt,
              links: annotationLinks({ ...record, manifest }, rebuilt.toLinks()),
            });
          } catch {
            // A manifest that does not compile again is one saving would change.
          }
          return { id, ...record, manifest, editable };
        }),
      );
      return shapes.filter((shape): shape is StoredShape => shape !== null);
    },

    async save(dataset, shape) {
      const shapeUri = await install(dataset, shape);
      await writeAnnotations(proxy(dataset), shape);
      return shapeUri;
    },

    async remove(dataset, id) {
      const perspective = proxy(dataset);
      const stored = (await shapesByNode(perspective)).get(id);
      const nodes = stored ? shapeNodes(stored) : [id];
      const annotations = (await linksOn(perspective, nodes)).filter(({ link }) => isAnnotation(link));
      if (annotations.length) await perspective.removeLinks(annotations.map(({ expression }) => expression));
    },
  };
}
