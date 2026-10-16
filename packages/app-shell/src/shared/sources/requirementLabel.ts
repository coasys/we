/**
 * A step's requirement in words, as the store says it — for a form that holds requirements it has not
 * saved yet, and so cannot read their words off a saved record.
 */
import { guardLabel } from '../flowViews';
import { guardSubjectOf } from '../guardSubjects';

export function requirementLabel(options: { entity?: unknown; tie?: unknown; min?: unknown }): string {
  const entity = typeof options?.entity === 'string' ? options.entity : '';
  if (!entity) return '';
  const tie = typeof options.tie === 'string' && options.tie ? { relation: options.tie } : undefined;
  const min = typeof options.min === 'number' && options.min >= 1 ? Math.floor(options.min) : undefined;
  return guardLabel({ kind: 'guard', ...guardSubjectOf(entity), ...(tie ? { tie } : {}), ...(min ? { min } : {}) });
}
