import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PrimitiveEntry, PropEntry } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Hand-maintained expansions for opaque type aliases that the regex-based
 * buildTypeAliasMap cannot resolve (imported types, branded unions, typeof
 * expressions, etc.).
 *
 * When adding new component prop types that expand to a string union,
 * add them here so the AI receives the actual valid values instead of
 * an opaque type name. The build will warn about any unresolved types
 * not in this map.
 */
const typeExpansions: Record<string, string> = {
  // Primitives
  ComponentSize: "'xs' | 'sm' | 'md' | 'lg' | 'xl'",
  ComponentVariant: "'neutral' | 'primary' | 'success' | 'warning' | 'danger'",
  IconSize: "'xs' | 'sm' | 'md' | 'lg' | 'xl' | '{css-length}'",
  SizeValue: "'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | '{css-length}'",
  TextVariant:
    "'' | 'body' | 'label' | 'footnote' | 'subheading' | 'ingress' | 'heading-sm' | 'heading' | 'heading-lg'",
  TextTag: "'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'small' | 'b' | 'i' | 'label' | 'div'",
  Placement:
    "'top' | 'bottom' | 'left' | 'right' | 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end' | 'left-start' | 'left-end' | 'right-start' | 'right-end'",
  ComboboxOption: '{ label: string; value: string; disabled?: boolean }',
};

/** Primitive types that are never opaque (no expansion needed). */
const knownPrimitiveTypes = new Set([
  'string',
  'boolean',
  'number',
  'unknown',
  'undefined',
  'string | undefined',
  'boolean | undefined',
  'number | undefined',
  'array',
  'HTMLElement',
  'File',
]);

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
 * Resolve a raw type string, expanding opaque names via the alias map
 * (from types.ts) or the hand-maintained typeExpansions fallback.
 * Handles compound types like "Foo | undefined" by resolving each part.
 * Warns at build time about types that remain unresolved.
 */
function resolveType(rawType: string, typeAliases: Map<string, string>): string {
  // Fast path: already resolved by buildTypeAliasMap
  if (typeAliases.has(rawType)) return typeAliases.get(rawType)!;

  // Fast path: known primitive / trivial
  if (knownPrimitiveTypes.has(rawType)) return rawType;

  // Already a string-literal union (e.g. "'xs' | 'sm' | 'md'")
  if (rawType.includes("'")) return rawType;

  // Resolve compound types: "AvatarSizeValue | undefined" → expand each part
  const parts = rawType.split('|').map((p) => p.trim());
  const resolved = parts.map((part) => {
    if (knownPrimitiveTypes.has(part)) return part;
    if (typeAliases.has(part)) return typeAliases.get(part)!;
    if (typeExpansions[part]) return typeExpansions[part];
    return part; // unresolved
  });
  const result = resolved.join(' | ');

  // Warn about remaining opaque types (not primitive, not string-literal, not array notation)
  for (const part of parts) {
    if (knownPrimitiveTypes.has(part)) continue;
    if (typeAliases.has(part)) continue;
    if (typeExpansions[part]) continue;
    if (part.includes("'")) continue;
    if (part.endsWith('[]')) continue;
    if (part.includes('=>')) continue; // function types
    if (part.includes('<')) continue; // generic types like Partial<...>
    if (part.startsWith('(')) continue; // grouped types like (string | ...)[]
    console.warn(`⚠ Unresolved type "${part}" in "${rawType}" — add to typeExpansions in cem.ts`);
  }

  return result;
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
        const resolvedType = resolveType(rawType, typeAliases);
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
