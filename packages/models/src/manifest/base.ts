/**
 * WE's additions to the neutral instance contract.
 *
 * `ModelInstance` itself — id, author, timestamps, save/delete — lives in `@we/backend-shared`
 * beside the query IR it types (`modelContract.ts`); this module carries only what is WE's:
 * the shared relations every WeNode-based entity offers, declared once in `shared.ts` and typed
 * once here.
 */
import type { ModelInstance } from '@we/backend-shared';

export type { ModelInstance };

/** One shared relation's accessor trio — add/remove one, set the whole list, addressed by id. */
interface RelationAccessors<K extends string> {
  addOne: { [P in K as `add${Capitalize<P>}`]: (value: string | { id: string }) => Promise<unknown> };
  removeOne: { [P in K as `remove${Capitalize<P>}`]: (value: string | { id: string }) => Promise<unknown> };
  setAll: { [P in K as `set${Capitalize<P>}`]: (values: (string | { id: string })[]) => Promise<unknown> };
}
type SharedRelationMethods<K extends string> = RelationAccessors<K>['addOne'] &
  RelationAccessors<K>['removeOne'] &
  RelationAccessors<K>['setAll'];

/**
 * What every WeNode-based entity additionally carries — the shared relations as stored URI bags,
 * with their accessor trios (consumers write rosters via `addParticipants` and the like, so the
 * accessors are contract, exactly as they are for the per-entity relations in `types.ts`).
 */
export interface WeNodeModel
  extends ModelInstance, SharedRelationMethods<'comments' | 'signals' | 'participants' | 'calls' | 'mentions'> {
  comments: string[];
  signals: string[];
  participants: string[];
  calls: string[];
  mentions: string[];
}
