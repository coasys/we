/**
 * A step's requirement in words, as the store says it — for a form that holds requirements it has not
 * saved yet, and so cannot read their words off a saved record.
 */
import { evidenceSubjectOf } from '../evidenceSubjects';
import { evidenceLabel } from '../workflowViews';

export function requirementLabel(options: { entity?: unknown; via?: unknown; min?: unknown }): string {
  const entity = typeof options?.entity === 'string' ? options.entity : '';
  if (!entity) return '';
  const via = typeof options.via === 'string' && options.via ? { relation: options.via } : undefined;
  const min = typeof options.min === 'number' && options.min >= 1 ? Math.floor(options.min) : undefined;
  return evidenceLabel({
    kind: 'evidence',
    ...evidenceSubjectOf(entity),
    ...(via ? { via } : {}),
    ...(min ? { min } : {}),
  });
}
