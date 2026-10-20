/**
 * templateSync — telling a template somebody else saved from one this agent already has, and
 * deciding what to do about it.
 *
 * A space's templates are read once, when the space opens, so a template edited elsewhere — by
 * another member, on another of this agent's devices, or by an agent asked to — used to reach nobody
 * until they reloaded. `TemplateStore` now watches the templates of the space on screen and of its
 * own library. This file is the part of that worth testing on its own: which records a push says
 * changed, and whether a change to the template on screen is applied or offered.
 *
 * Framework-free: the store does the watching and the applying.
 */

/**
 * The fields a watch reads: enough to say a record changed, and never its content — a template is
 * a blob that can run to hundreds of kilobytes, read once a change is known.
 */
export const TEMPLATE_WATCH_FIELDS = ['slug', 'role', 'version', 'updatedAt'] as const;

/** The cheap fields a watch reads — never the content, which is the expensive part. */
export interface TemplateStamp {
  id: string;
  version?: unknown;
  updatedAt?: unknown;
}

/** What a push of the whole result means, against the last one. */
export interface TemplateChanges {
  /** The stamps to compare the next push against. */
  next: Map<string, string>;
  /** Records added or changed since the last push, less this agent's own saves arriving back. */
  changed: string[];
  /** Records no longer there. */
  removed: string[];
}

const stampOf = (row: TemplateStamp) => `${String(row.version ?? '')}|${String(row.updatedAt ?? '')}`;

/**
 * Compare a push with the last one.
 *
 * A push is the whole result, and on some backends it arrives on every write to the dataset, so
 * "a push came" means nothing on its own: a record changed when its stamp did. The first push only
 * sets the baseline — everything in it was read when the space opened.
 *
 * `ownSaves` holds the version this agent last saved for each record, and a record arriving at that
 * version is this agent's own save coming back, not news. It is consumed as it is matched, so a
 * later change by anybody else at another version is still seen.
 */
export function templateChanges(
  previous: Map<string, string> | undefined,
  rows: readonly TemplateStamp[],
  ownSaves: Map<string, string>,
): TemplateChanges {
  const next = new Map(rows.map((row) => [row.id, stampOf(row)]));
  if (!previous) return { next, changed: [], removed: [] };

  const changed: string[] = [];
  for (const row of rows) {
    const stamp = next.get(row.id)!;
    if (previous.get(row.id) === stamp) continue;
    if (ownSaves.get(row.id) === String(row.version ?? '')) {
      ownSaves.delete(row.id);
      continue;
    }
    changed.push(row.id);
  }
  const removed = [...previous.keys()].filter((id) => !next.has(id));
  return { next, changed, removed };
}

/**
 * What to do when the template on screen changed elsewhere.
 *
 * - `apply`: put it on screen now. This agent's own change from somewhere else, or somebody who has
 *   asked to follow others' changes.
 * - `apply-editing`: put it on screen now and say so, because it is being edited here — its undo
 *   history describes the version before, and editing on a stale copy would overwrite the newer
 *   one at the next autosave.
 * - `offer`: leave the page alone and offer the update, so nothing changes under somebody mid-task.
 */
export type RemoteUpdate = 'apply' | 'apply-editing' | 'offer';

export function remoteUpdateFor(change: {
  /** Who saved the version that arrived, as the saved template records it. */
  author: string | undefined;
  me: string | undefined;
  /** An editing session is open on this template here. */
  editing: boolean;
  /** This agent's setting: apply others' changes as they arrive. */
  followOthers: boolean;
}): RemoteUpdate {
  if (change.editing) return 'apply-editing';
  if (change.author && change.author === change.me) return 'apply';
  return change.followOthers ? 'apply' : 'offer';
}
