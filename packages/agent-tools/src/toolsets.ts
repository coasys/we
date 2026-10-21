/**
 * Every toolset this package offers a host, by name — the entry a host looks up. Each says which
 * entities its tools work on, so a host can tell which records a call may name.
 */
import type { RecordToolset } from './core/toolset';
import { templateToolset } from './templates/templateToolset';

export const toolsets: Record<string, RecordToolset> = {
  template: templateToolset,
};
