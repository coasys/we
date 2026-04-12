import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PrimitiveEntry, PropEntry } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Build a map of named type aliases → resolved literal union text
 * by parsing `export type X = 'a' | 'b' | 'c';` from types.ts.
 */
function buildTypeAliasMap(cemPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const typesPath = resolve(dirname(cemPath), 'src', 'types.ts');
  if (!existsSync(typesPath)) return map;

  const src = readFileSync(typesPath, 'utf-8');
  // Match:  export type Name = 'a' | 'b' | 'c';
  const re = /export\s+type\s+(\w+)\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m;
    const trimmed = body.trim();
    // Only resolve if body is a union of string literals (possibly with '')
    // e.g. "'primary' | 'secondary'" or "'' | 'sm' | 'lg'"
    const parts = trimmed.split('|').map((p) => p.trim());
    if (parts.every((p) => /^'[^']*'$/.test(p))) {
      map.set(name, trimmed);
    }
  }
  return map;
}

interface CEMModule {
  path: string;
  declarations?: CEMDeclaration[];
}

interface CEMDeclaration {
  kind: string;
  name: string;
  tagName?: string;
  description?: string;
  customElement?: boolean;
  superclass?: { name: string; module: string };
  members?: CEMMember[];
}

interface CEMMember {
  kind: string;
  name: string;
  type?: { text: string };
  default?: string;
  privacy?: string;
  inheritedFrom?: { name: string; module: string };
}

interface CEMManifest {
  modules: CEMModule[];
}

/**
 * Extract primitive web components from Custom Elements Manifest.
 * Only includes own props (not inherited DesignSystemProps).
 */
export function extractPrimitives(cemPath?: string): PrimitiveEntry[] {
  const resolvedPath = cemPath ?? resolve(__dirname, '../../../../design-system/3-primitives/custom-elements.json');

  const manifest: CEMManifest = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
  const typeAliases = buildTypeAliasMap(resolvedPath);
  const entries: PrimitiveEntry[] = [];

  for (const mod of manifest.modules) {
    for (const decl of mod.declarations ?? []) {
      if (decl.kind !== 'class' || !decl.tagName) continue;

      const ownProps: PropEntry[] = [];
      for (const member of decl.members ?? []) {
        if (member.kind !== 'field') continue;
        if (member.privacy === 'private') continue;
        if (member.inheritedFrom) continue;
        if (member.name.startsWith('_')) continue;
        // Filter out DesignSystem mixin props (shared across all primitives)
        if (member.type?.text?.startsWith('DesignSystemProps[')) continue;

        const rawType = member.type?.text ?? 'unknown';
        const resolvedType = typeAliases.get(rawType) ?? rawType;
        ownProps.push({
          name: member.name,
          type: resolvedType,
          optional: member.type?.text?.includes('undefined') ?? false,
          default: member.default,
        });
      }

      entries.push({
        tagName: decl.tagName,
        className: decl.name,
        description: decl.description || undefined,
        superclass: decl.superclass?.name,
        ownProps,
      });
    }
  }

  return entries.sort((a, b) => a.tagName.localeCompare(b.tagName));
}
