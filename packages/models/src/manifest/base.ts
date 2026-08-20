/**
 * The neutral instance contract every backend's model implementations answer to.
 *
 * What a consumer may rely on about *any* record, whatever holds it: an id, who wrote it, when,
 * and the mutation methods the CRUD conventions use — mutate by assigning fields and calling
 * `save()`; there is deliberately no instance `update`. Deliberately minimal — everything else a
 * model instance offers is either declared per-entity (the generated interfaces in `types.ts`)
 * or a backend's own ergonomics (relation accessor methods, query sugar), which conformance
 * neither requires nor forbids.
 *
 * `createdAt`/`updatedAt` are `unknown` rather than a committed representation: the AD4M lane
 * hands back epoch numbers parsed from ISO strings, and another backend may reasonably differ.
 * Committing the contract to one shape here would make every consumer's comparison code a silent
 * porting hazard instead of a visible one.
 */
export interface ModelInstance {
  readonly id: string;
  author: string;
  createdAt: unknown;
  updatedAt: unknown;
  save(): Promise<unknown>;
  delete(): Promise<unknown>;
}

/**
 * What every WeNode-based entity additionally carries — the shared relations declared once in
 * `shared.ts`, as the URI bags they are stored as.
 */
export interface WeNodeModel extends ModelInstance {
  comments: string[];
  signals: string[];
  participants: string[];
  calls: string[];
  mentions: string[];
}
