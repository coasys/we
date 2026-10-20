/**
 * Every toolset this package offers a host, by name — the entry a host looks up. Each says which
 * entities it edits, so a host can pick one from the record it was asked about.
 */
import type { RecordToolsetEntry } from './core/toolset';
import { templateRecordToolset } from './templates/templateRecordToolset';

export const toolsets: Record<string, RecordToolsetEntry> = {
  template: templateRecordToolset,
};
