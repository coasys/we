/**
 * GENERATED from src/manifest/blocks/EmbedBlock.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

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
@Model({ name: 'EmbedBlock' })
export class EmbedBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://embed_block' })
  flag: string = '';

  @Property({ through: 'we://url' })
  url: string = '';

  @Property({ through: 'we://target' })
  target: string = '';

  @Property({ through: 'we://target_type' })
  targetType: string = '';

  /** How the referenced thing was called when it was embedded. */
  @Property({ through: 'we://title' })
  label: string = '';

  /** A picture of it, likewise. */
  @Property({ through: 'we://thumbnail' })
  thumbnail: string = '';

  @Property({ through: 'we://display_mode' })
  displayMode: string = 'card';

  @Property({ through: 'we://version' })
  version: number = 0;
}
