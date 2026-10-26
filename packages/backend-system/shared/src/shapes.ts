/**
 * Where a space keeps its own models — the entities a community defined for itself, as opposed to the
 * vocabulary WE ships.
 *
 * A model is described to WE as an {@link EntityManifest}: one format for the wizard, the AI, the
 * validator and a bundle. How a backend *keeps* it is the backend's. The default is the manifest as a
 * document on a `Shape` record. A backend whose own schema language can say most of what a manifest
 * says keeps the model in that form instead, and reads a manifest back out of it — so a space holds
 * one copy of each model, never a document beside a compiled schema that can drift from it.
 *
 * Either way the contract is the same, and so is what comes back: a stored model reads back as the
 * manifest it was saved as. What a backend's own form holds beyond the manifest — written there by
 * other software — it keeps, and reports by `editable: false`, so a save from WE never drops it.
 */
import type { DatasetHandle } from './dataSource';
import type { EntityManifest } from './manifest';

/** One model a space carries, as stored. */
export interface StoredShape {
  /** The store's own id for it — stable for as long as the model is kept. */
  id: string;
  /** The entity's name — `Sighting`. How queries name it; not changeable once data exists. */
  name: string;
  description: string;
  icon: string;
  /**
   * Its identity across spaces (`we://shapes/<uuid>`), minted once. Two spaces holding the same
   * `shapeId` hold the same model, whatever they renamed it to.
   */
  shapeId: string;
  /** Bumped on every accepted edit. */
  version: number;
  /** The `shapeId@version` it was copied or forked from; empty for an original. */
  forkedFrom: string;
  /** The definition, or `null` when what is stored could not be read as one. */
  manifest: EntityManifest | null;
  /**
   * The stored form says exactly what the manifest says. False when it holds more — something other
   * than WE wrote to it — so saving it from here would drop the rest.
   */
  editable: boolean;
}

/** What a save writes: everything a stored model has but its id and whether it reads back whole. */
export type ShapeInput = Omit<StoredShape, 'id' | 'manifest' | 'editable'> & { manifest: EntityManifest };

export interface ShapeStore {
  /** Every model the space carries. */
  list(dataset: DatasetHandle): Promise<StoredShape[]>;
  /** Store a model, replacing the one with this id when given. Resolves with its id. */
  save(dataset: DatasetHandle, shape: ShapeInput, id?: string): Promise<string>;
  /**
   * Stop carrying a model. Records of it keep their data and stay readable as what they are; the
   * space simply no longer lists the model among its own.
   */
  remove(dataset: DatasetHandle, id: string): Promise<void>;
  /**
   * After a model's schema has been (re)installed: put back whatever of the stored model the install
   * rewrote. A backend whose install never touches what it stores leaves this out.
   */
  keep?(dataset: DatasetHandle, shape: ShapeInput): Promise<void>;
}
