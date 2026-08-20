/**
 * Scans the codebase for we-icon usage and generates a bundled icon map
 * from the installed @phosphor-icons/core package.
 *
 * Usage: tsx scripts/collect-icons.ts
 */

import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Phosphor icon weights
const WEIGHTS = ['thin', 'light', 'regular', 'bold', 'fill', 'duotone'] as const;

/** Walk up from cwd to find the monorepo root (contains pnpm-workspace.yaml) */
function findRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = resolve(dir, '..');
  }
  throw new Error('Could not find monorepo root (no pnpm-workspace.yaml found)');
}

const ROOT = findRoot();
const PRIMITIVES_ROOT = resolve(ROOT, 'packages/design-system/3-primitives');
const PHOSPHOR_ASSETS = resolve(PRIMITIVES_ROOT, 'node_modules/@phosphor-icons/core/assets');
const OUT_DIR = resolve(PRIMITIVES_ROOT, 'src/generated');
const OUT_FILE = resolve(OUT_DIR, 'icon-bundle.ts');

// Directories to scan (relative to workspace root)
//
// Templates and feature modules are in here for the same reason the app is: an icon named anywhere
// that ships with a deployment has to render without a network. They were missing, so every icon a
// built-in template asked for fell through to the CDN fallback — which looks fine in development
// and leaves blank squares on a desktop build with no connection.
const SCAN_GLOBS = [
  'packages/app-framework/src/**/*.{ts,tsx}',
  'packages/app-shell/src/**/*.{ts,tsx}',
  'packages/design-system/**/src/**/*.{ts,tsx}',
  'packages/block-system/**/src/**/*.{ts,tsx}',
  'packages/schema-system/**/src/**/*.{ts,tsx}',
  'packages/module-system/**/src/**/*.{ts,tsx}',
  'packages/templates/**/src/**/*.{ts,tsx}',
  'packages/editor/src/**/*.{ts,tsx}',
  'apps/**/src/**/*.{ts,tsx}',
  'views/**/*.{ts,tsx}',
];

interface IconRef {
  name: string;
  weight: string;
}

/** Collect files matching the scan globs */
function collectSourceFiles(): string[] {
  const files: string[] = [];
  for (const pattern of SCAN_GLOBS) {
    try {
      const matches = globSync(pattern, { cwd: ROOT });
      files.push(...matches.map((m) => resolve(ROOT, m)));
    } catch {
      // Glob pattern may not match anything — that's fine
    }
  }
  return [...new Set(files)];
}

/** Extract icon references from a file's content */
function extractIconRefs(content: string): IconRef[] {
  const refs: IconRef[] = [];
  let match: RegExpExecArray | null;

  // Pattern 1: HTML attribute — <we-icon name="icon-name" ...>
  const htmlAttrRegex = /<we-icon\b[^>]*?\bname=["']([a-z][a-z0-9-]*)["'][^>]*?>/g;
  while ((match = htmlAttrRegex.exec(content)) !== null) {
    const fullTag = match[0];
    const name = match[1];
    const weightMatch = fullTag.match(/\bweight=["']([a-z]+)["']/);
    const weight = weightMatch ? weightMatch[1] : 'regular';
    if (WEIGHTS.includes(weight as (typeof WEIGHTS)[number])) {
      refs.push({ name, weight });
    }
  }

  // Pattern 2: Lit template expressions with string literals near we-icon
  // Catches: name=${'icon-name'}, name=${cond ? 'icon-a' : 'icon-b'}
  const litExprRegex = /<we-icon\b[^>]*?\bname=\$\{([^}]+)\}[^>]*?>/g;
  while ((match = litExprRegex.exec(content)) !== null) {
    const expr = match[1];
    const fullTag = match[0];
    const weightMatch = fullTag.match(/\bweight=["']([a-z]+)["']/);
    const weight = weightMatch ? weightMatch[1] : 'regular';
    // Extract all string literals from the expression
    const stringLiterals = [...expr.matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)];
    for (const lit of stringLiterals) {
      if (WEIGHTS.includes(weight as (typeof WEIGHTS)[number])) {
        refs.push({ name: lit[1], weight });
      }
    }
  }

  // Pattern 3: Schema objects — type: 'we-icon' with name in props
  // Matches across multiple lines within a reasonable range
  const schemaIconRegex = /type:\s*['"]we-icon['"][^}]*?name:\s*['"]([a-z][a-z0-9-]*)['"]([^}]*)/g;
  while ((match = schemaIconRegex.exec(content)) !== null) {
    const name = match[1];
    const rest = match[2];
    const weightMatch = rest.match(/weight:\s*['"]([a-z]+)['"]/);
    const weight = weightMatch ? weightMatch[1] : 'regular';
    if (WEIGHTS.includes(weight as (typeof WEIGHTS)[number])) {
      refs.push({ name, weight });
    }
  }

  // Pattern 4: Schema objects — name before type
  const schemaIconRegex2 = /name:\s*['"]([a-z][a-z0-9-]*)['"][^}]*?type:\s*['"]we-icon['"]/g;
  while ((match = schemaIconRegex2.exec(content)) !== null) {
    const name = match[1];
    refs.push({ name, weight: 'regular' });
  }

  return refs;
}

/** Read an SVG from the phosphor-icons/core package */
function readPhosphorSvg(name: string, weight: string): string | null {
  const fileName = weight === 'regular' ? `${name}.svg` : `${name}-${weight}.svg`;
  const svgPath = resolve(PHOSPHOR_ASSETS, weight, fileName);
  if (!existsSync(svgPath)) return null;
  return readFileSync(svgPath, 'utf-8');
}

function main() {
  console.log('Collecting icon references from codebase...');

  const files = collectSourceFiles();
  console.log(`Scanning ${files.length} files...`);

  // Collect all unique icon references
  const iconSet = new Map<string, IconRef>();
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const refs = extractIconRefs(content);
      for (const ref of refs) {
        const key = `${ref.name}:${ref.weight}`;
        iconSet.set(key, ref);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  console.log(`Found ${iconSet.size} unique icon references.`);

  // Read SVGs and build bundle
  const entries: Array<[string, string]> = [];
  let missing = 0;
  for (const [key, ref] of iconSet) {
    const svg = readPhosphorSvg(ref.name, ref.weight);
    if (svg) {
      entries.push([key, svg.trim()]);
    } else {
      console.warn(`  Warning: SVG not found for "${key}"`);
      missing++;
    }
  }

  // Sort for deterministic output
  entries.sort(([a], [b]) => a.localeCompare(b));

  // Generate the output module
  const lines = [
    '// Auto-generated by scripts/collect-icons.ts — do not edit manually',
    '// Re-generate with: pnpm build:icons',
    '',
    'export const bundledIcons: Record<string, string> = {',
  ];

  for (const [key, svg] of entries) {
    // Escape backticks and backslashes for template literal safety
    const escaped = svg.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    lines.push(`  '${key}': \`${escaped}\`,`);
  }

  lines.push('};');
  lines.push('');

  // Ensure output directory exists
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, lines.join('\n'), 'utf-8');

  console.log(`Generated ${OUT_FILE}`);
  console.log(`  ${entries.length} icons bundled, ${missing} missing.`);
}

main();
