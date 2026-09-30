import { pathToFileURL } from 'node:url';

import type { PluginCatalog } from '@we/schema-shared';

/**
 * Read a package's plugin catalog.
 *
 * Imported rather than parsed. Every other extractor here reads the AST, because it is recovering
 * structure from code that was written for another purpose — decorators, prop interfaces, token
 * objects. A catalog is *already* the documentation, authored as data for exactly this, so parsing it
 * back out of its own source would be ceremony that could only introduce a way for the two to
 * disagree. The generator runs under tsx, so a `.ts` module imports directly.
 *
 * A catalog that fails to load is reported and skipped: a broken one in a module nobody is working on
 * should not take down the reference for everything else.
 */
export async function extractPluginCatalog(entry: string): Promise<PluginCatalog[]> {
  try {
    const module = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
    const catalogs = Object.values(module).filter(isCatalog);
    if (!catalogs.length) {
      console.warn(`  Warning: ${entry} exports no plugin catalog`);
    }
    return catalogs;
  } catch (error) {
    console.warn(`  Warning: could not read plugin catalog at ${entry}: ${describe(error)}`);
    return [];
  }
}

function isCatalog(value: unknown): value is PluginCatalog {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PluginCatalog>;
  return typeof candidate.component === 'string' && Array.isArray(candidate.plugins);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
