/**
 * What a step's requirement can ask to be there, in words and as the records that count.
 *
 * A requirement names an entity and, optionally, conditions on it. "A comment" is not an entity of
 * its own: a reply is a `CollectionBlock` of kind `reply`, and so is a call held about a record — both
 * sit in its `responses`. Asking for any `CollectionBlock` would let a call count as a comment, and
 * asking for a `TextBlock` (what a comment *contains*) matches nothing in response to a record at all.
 * So the editor offers these by key, and each key says exactly which records count.
 */
import type { FlowGuard } from '@we/backend-shared';

export interface GuardSubject {
  /** What the form's picker holds. */
  key: string;
  one: string;
  many: string;
  entity: string;
  where?: Record<string, string>;
}

export const GUARD_SUBJECTS: readonly GuardSubject[] = [
  { key: 'comment', one: 'comment', many: 'comments', entity: 'CollectionBlock', where: { kind: 'reply' } },
  { key: 'call', one: 'call', many: 'calls', entity: 'CollectionBlock', where: { kind: 'call' } },
  { key: 'task', one: 'task', many: 'tasks', entity: 'TaskBlock' },
  { key: 'file', one: 'file', many: 'files', entity: 'FileBlock' },
  { key: 'link', one: 'link', many: 'links', entity: 'LinkBlock' },
  { key: 'image', one: 'image', many: 'images', entity: 'ImageBlock' },
];

/** The records a picker's key stands for. Anything else is taken as an entity name, unconditioned. */
export function guardSubjectOf(what: string): { entity: string; where?: Record<string, string> } {
  const subject = GUARD_SUBJECTS.find((s) => s.key === what);
  return subject
    ? { entity: subject.entity, ...(subject.where ? { where: { ...subject.where } } : {}) }
    : { entity: what };
}

/** The catalogue entry a stored requirement is, when it is one — for saying it in words. */
export function subjectOfGuard(guard: Pick<FlowGuard, 'entity' | 'where'>): GuardSubject | undefined {
  const where = guard.where ?? {};
  return GUARD_SUBJECTS.find((s) => {
    if (s.entity !== guard.entity) return false;
    const wanted = s.where ?? {};
    const keys = new Set([...Object.keys(wanted), ...Object.keys(where)]);
    return [...keys].every((k) => wanted[k] === where[k]);
  });
}
