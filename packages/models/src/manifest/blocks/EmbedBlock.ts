import type { CoreEntityDef } from '../defs';

/**
 * Something else, shown inside a composition — a URL, or a record somewhere in WE.
 *
 * `target` and `targetType` predate this and were never written: `EmbedInput` and `EmbedDisplay`
 * both read `url || target` and put it in an `href`. They are what a **record reference** goes in
 * — `we:<datasetKey>/<Entity>/<id>`, see `@we/backend-shared`'s `recordRef` — which is what a
 * Pocket row dropped into the composer becomes.
 *
 * `label` and `thumbnail` are the snapshot beside it, and they exist for the same reason the
 * Pocket's do: `EmbedDisplay` runs in a paint path, and a paint path must not do a cross-dataset
 * lookup. With them the card draws immediately; without them it falls back to the entity name,
 * which is what an embed written before this release has.
 */
export const EmbedBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://embed_block' },
    properties: {
      url: { type: 'string', predicate: 'we://url', default: '' },
      target: { type: 'string', predicate: 'we://target', default: '' },
      targetType: { type: 'string', predicate: 'we://target_type', default: '' },
      /** How the referenced thing was called when it was embedded. */
      label: { type: 'string', predicate: 'we://title', default: '' },
      /** A picture of it, likewise. */
      thumbnail: { type: 'string', predicate: 'we://thumbnail', default: '' },
      displayMode: { type: 'string', predicate: 'we://display_mode', default: 'card' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
