/**
 * A space's own models, kept as the SHACL the executor already stores for them — and nothing else.
 *
 * Saving a model compiles its manifest into a class and installs its SHACL, the path every module
 * entity takes, then writes the annotation links that carry what SHACL cannot say (`shapeCodec.ts`).
 * Listing reads the two back into manifests. There is no second copy: when other software edits a
 * model's shape, WE reads the edit rather than overwriting it from a document of its own, and a shape
 * holding more than WE's manifest can say reads back as not editable, so a save from WE never drops it.
 *
 * ## Annotations survive an install by being put back
 *
 * Installing a shape whose structure changed rewrites every link on its nodes, these included. So
 * every save writes them after installing, and `keep` writes them again after any later install —
 * diff-first, so a pass with nothing to change writes nothing.
 *
 * ## Removing
 *
 * Takes away the annotations, so the space no longer lists the model as one of its own. The SHACL
 * stays: records of the model keep their type and remain readable as what they are.
 */
import { Link, LinkQuery, type PerspectiveProxy } from '@coasys/ad4m';
import type { DatasetHandle, EntityManifest, ShapeInput, ShapeStore, StoredShape } from '@we/backend-shared';

import { compileManifest } from './manifestCompiler';
import { ANNOTATION, annotationLinks, isAnnotation, linkKey, type LinkLike, readShape, sameShape } from './shapeCodec';

const proxy = (dataset: DatasetHandle) => dataset as PerspectiveProxy;

type Shaped = { generateSHACL: () => { shape: { nodeShapeUri: string; toLinks(): LinkLike[] } } };

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
  return cls as unknown as Shaped;
}

/** Every link on a shape's node and on its property shapes, as the perspective holds them. */
async function shapeLinks(perspective: PerspectiveProxy, shapeUri: string): Promise<LinkLike[]> {
  const own = (await perspective.get(new LinkQuery({ source: shapeUri }))).map((l) => l.data);
  const fields = own.filter((l) => l.predicate === 'sh://property').map((l) => l.target);
  const theirs = await Promise.all(fields.map((field) => perspective.get(new LinkQuery({ source: field }))));
  return [...own, ...theirs.flat().map((l) => l.data)];
}

/** Make a model's annotations say what `shape` says: add what is missing, remove what is stale. */
async function writeAnnotations(perspective: PerspectiveProxy, shape: ShapeInput, shapeUri: string): Promise<void> {
  const held = await shapeLinks(perspective, shapeUri);
  if (!held.length) throw new Error(`shapes: "${shape.name}" has no stored shape to annotate`);
  const desired = annotationLinks(
    shape,
    held.filter((l) => !isAnnotation(l)),
  );
  const desiredKeys = new Set(desired.map(linkKey));
  const stored = await annotationExpressions(perspective, held);
  const storedKeys = new Set(stored.map(({ link }) => linkKey(link)));
  const stale = stored.filter(({ link }) => !desiredKeys.has(linkKey(link)));
  const missing = desired.filter((l) => !storedKeys.has(linkKey(l)));
  if (stale.length) await perspective.removeLinks(stale.map(({ expression }) => expression) as never);
  if (missing.length) await perspective.addLinks(missing.map((l) => new Link(l)));
}

/** The stored annotation links on a shape's nodes, with the expressions removing one needs. */
async function annotationExpressions(perspective: PerspectiveProxy, held: readonly LinkLike[]) {
  const sources = [...new Set(held.map((l) => l.source))];
  const found = await Promise.all(sources.map((source) => perspective.get(new LinkQuery({ source }))));
  return found
    .flat()
    .filter((expression) => isAnnotation(expression.data))
    .map((expression) => ({ expression, link: expression.data as LinkLike }));
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
      const marked = await perspective.get(new LinkQuery({ predicate: ANNOTATION.shapeId }));
      const shapeUris = [...new Set(marked.map((l) => l.data.source))];
      const shapes = await Promise.all(
        shapeUris.map(async (shapeUri): Promise<StoredShape | null> => {
          const links = await shapeLinks(perspective, shapeUri);
          let read;
          try {
            read = readShape(links);
          } catch (error) {
            console.warn(`ad4m: the stored model at ${shapeUri} could not be read`, error);
            return null;
          }
          if (!read) return null;
          const { shapeUri: id, manifest, ...record } = read;
          let editable = false;
          try {
            const rebuilt = compiled({ ...record, manifest }, (name) => deps.resolveExternal?.(dataset, name))
              .generateSHACL()
              .shape.toLinks();
            editable = sameShape(links, [...rebuilt, ...annotationLinks({ ...record, manifest }, rebuilt)]);
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
      await writeAnnotations(proxy(dataset), shape, shapeUri);
      return shapeUri;
    },

    async remove(dataset, id) {
      const perspective = proxy(dataset);
      const held = await shapeLinks(perspective, id);
      const annotations = await annotationExpressions(perspective, held);
      if (annotations.length) await perspective.removeLinks(annotations.map(({ expression }) => expression) as never);
    },

    async keep(dataset, shape) {
      await writeAnnotations(proxy(dataset), shape, compiled(shape).generateSHACL().shape.nodeShapeUri);
    },
  };
}
