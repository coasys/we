/**
 * The default place a space keeps its own models: each one a `Shape` record, holding the manifest as a
 * JSON document beside the record's metadata.
 *
 * What a backend uses when it has no form of its own to keep a model in — the test double, and the
 * host when a backend's `SchemaPort.shapes` is absent. It is complete on its
 * own — the manifest *is* what is stored, so it reads back exactly as saved and nothing else can be in
 * it — which is why `editable` is always true and `keep` has nothing to do.
 */
import type { DatasetHandle, EntityManifest, ShapeInput, ShapeStore, StoredShape } from '@we/backend-shared';

import { type DatasetProxy, Shape } from './index';
import { decodeFileAsJson, encodeJsonFileData } from './utils/fileTransforms';
import { asFileField } from './utils/imageHelpers';

/**
 * @param ensure Installs the `Shape` entity into a dataset that predates it — the diff-first install
 *   every reader of a space's vocabulary does first. A read in the common case.
 */
export function createJsonShapeStore(ensure: (dataset: DatasetHandle) => Promise<void>): ShapeStore {
  const proxy = (dataset: DatasetHandle) => dataset as DatasetProxy;
  /**
   * The stored document, as a backend hands a file property back: the data URI the file is read as,
   * or — where the backend keeps what was written as written — the file value itself.
   */
  const readDefinition = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && typeof (value as { data_base64?: unknown }).data_base64 === 'string') {
      const file = value as { data_base64: string; file_type?: string };
      return decodeFileAsJson(`data:${file.file_type || 'application/json'};base64,${file.data_base64}`);
    }
    return typeof value === 'string' ? decodeFileAsJson(value) : {};
  };
  const definitionOf = (manifest: EntityManifest) => asFileField(encodeJsonFileData(manifest, 'shape-definition.json'));

  return {
    async list(dataset) {
      await ensure(dataset);
      const records = await Shape.findAll(proxy(dataset));
      return records.map((record): StoredShape => {
        const decoded = readDefinition(record.definition);
        return {
          id: record.id,
          name: record.name,
          description: record.description ?? '',
          icon: record.icon ?? '',
          shapeId: record.shapeId ?? '',
          version: record.version ?? 1,
          forkedFrom: record.forkedFrom ?? '',
          manifest: Object.keys(decoded).length ? (decoded as unknown as EntityManifest) : null,
          editable: true,
        };
      });
    },

    async save(dataset, shape: ShapeInput, id) {
      await ensure(dataset);
      const p = proxy(dataset);
      if (id) {
        const record = (await Shape.findAll(p)).find((r) => r.id === id);
        if (!record) throw new Error('shapes: the model being saved is no longer stored');
        record.description = shape.description;
        record.icon = shape.icon;
        record.version = shape.version;
        record.forkedFrom = shape.forkedFrom;
        record.definition = definitionOf(shape.manifest);
        await record.save();
        return record.id;
      }
      const made = await Shape.create(p, {
        name: shape.name,
        description: shape.description,
        icon: shape.icon,
        shapeId: shape.shapeId,
        version: shape.version,
        forkedFrom: shape.forkedFrom,
        definition: definitionOf(shape.manifest),
      });
      return made.id;
    },

    async remove(dataset, id) {
      const record = (await Shape.findAll(proxy(dataset))).find((r) => r.id === id);
      if (record) await record.delete();
    },
  };
}
