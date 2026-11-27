/**
 * `create(…, { id })`, on AD4M's model layer: a record made under an id the caller chose.
 *
 * The contract lets a caller name the id a new record will have (`CreateOptions.id`), and refuses a
 * create onto an id that is already held. `Ad4mModel.create` takes no id: it builds its instance with
 * `new this(perspective)`, which mints one. A model's id is its base expression — what the
 * constructor's second argument sets, `new Model(perspective, id)` — and `create` assigns the data it
 * is given onto the instance before it writes anything, so the id goes in with the data, as the base
 * expression and marked as not minted (a minted id is one no link can point at yet, which the model
 * layer uses to skip clearing relations nothing could hold). Everything else `create` does — the
 * write check, the parent link, the batch — is the SDK's own, unchanged.
 *
 * ## What "already held" is judged against
 *
 * A record on AD4M is the links out of its base expression, so an id is held when any link starts
 * there. The check reads the perspective, and a perspective read sees **committed** links only: the
 * executor keeps a batch's writes out of every read until it commits. So a create onto an id an
 * earlier write in the *same* batch is about to create is not caught here, and the batch commits
 * both. A caller that groups creates is expected to know which ids it has already used in the group —
 * a runner of compound writes holds its own pending writes for exactly this — and the check stands
 * against everything that has landed.
 *
 * Installed on the base class, as the other model patches are, so every class takes the option.
 */
import { type Ad4mModel, LinkQuery, type PerspectiveProxy } from '@coasys/ad4m';
import { RecordExistsError } from '@we/backend-shared';

const PATCHED = Symbol.for('we.ad4m.callerIds');

type Create = (this: unknown, perspective: unknown, data?: Record<string, unknown>, options?: unknown) => unknown;

/** Install the option on `Ad4mModel.create`. Idempotent. */
export function installCallerIds(model: typeof Ad4mModel): void {
  const statics = model as unknown as Record<string | symbol, unknown>;
  if (statics[PATCHED]) return;
  const original = statics.create as Create | undefined;
  if (typeof original !== 'function') return;
  statics[PATCHED] = true;

  statics.create = async function withCallerId(
    this: unknown,
    perspective: unknown,
    data: Record<string, unknown> = {},
    options?: unknown,
  ) {
    const { id, ...rest } = (options && typeof options === 'object' ? options : {}) as { id?: unknown };
    if (id === undefined) return original.call(this, perspective, data, options);
    if (typeof id !== 'string' || !id) throw new Error('create(): the "id" option must be a non-empty string');
    const held = await (perspective as PerspectiveProxy).get(new LinkQuery({ source: id }));
    if (held.length) throw new RecordExistsError(id);
    return original.call(this, perspective, { ...data, _baseExpression: id, _idMinted: false }, rest);
  };
}
