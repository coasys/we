import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

import type { TokenCategory } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract design token categories from the tokens source files.
 *
 * Parses each token file with ts-morph, extracting exported const objects
 * that use `satisfies Record<X, string>`. For composite objects (font, animation, etc.),
 * flattens into sub-categories like "font.size", "font.weight".
 */
export function extractTokens(tokensDir?: string): TokenCategory[] {
  const dir = tokensDir ?? resolve(__dirname, '../../../../design-system/1-tokens/src');

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFiles = project.addSourceFilesAtPaths(`${dir}/*.ts`);

  const categories: TokenCategory[] = [];
  // Track flat objects so composites can reference them
  const flatObjects = new Map<string, TokenCategory>();

  // First pass: extract all `satisfies Record<X, string>` objects
  for (const sf of sourceFiles) {
    if (sf.getBaseName() === 'index.ts') continue;

    for (const varDecl of sf.getVariableDeclarations()) {
      const name = varDecl.getName();
      const init = varDecl.getInitializer();
      if (!init) continue;

      // Check for `satisfies Record<X, string>` pattern
      const satisfiesExpr = init.getKind() === SyntaxKind.SatisfiesExpression ? init : null;
      if (!satisfiesExpr) continue;

      const objectLiteral = satisfiesExpr.getFirstChildByKind(SyntaxKind.ObjectLiteralExpression);
      if (!objectLiteral) continue;

      const values = extractObjectValues(objectLiteral);
      const typeText = satisfiesExpr.getChildAtIndex(2)?.getText() ?? '';

      flatObjects.set(name, { name, type: typeText, values });
    }
  }

  // Second pass: extract exported composites and standalone flat objects
  const consumed = new Set<string>(); // flat objects consumed by composites

  for (const sf of sourceFiles) {
    if (sf.getBaseName() === 'index.ts') continue;

    for (const varDecl of sf.getVariableDeclarations()) {
      if (!varDecl.isExported()) continue;

      const name = varDecl.getName();
      const init = varDecl.getInitializer();
      if (!init) continue;

      // Skip satisfies expressions — handled below after composites
      if (init.getKind() === SyntaxKind.SatisfiesExpression) continue;

      // Composite object: { family: fontFamily, size: fontSize, ... }
      const obj = init.asKind(SyntaxKind.ObjectLiteralExpression);
      if (!obj) continue;

      for (const prop of obj.getProperties()) {
        if (
          prop.getKind() !== SyntaxKind.PropertyAssignment &&
          prop.getKind() !== SyntaxKind.ShorthandPropertyAssignment
        ) {
          continue;
        }

        const subName =
          prop.getKind() === SyntaxKind.ShorthandPropertyAssignment
            ? prop.asKindOrThrow(SyntaxKind.ShorthandPropertyAssignment).getName()
            : prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getName();

        // Resolve the referenced variable
        const subInit =
          prop.getKind() === SyntaxKind.PropertyAssignment
            ? prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializerOrThrow()
            : null;

        const refName = subInit?.getText() ?? subName;
        const resolved = flatObjects.get(refName);

        if (resolved) {
          consumed.add(refName);
          categories.push({
            name: `${name}.${subName}`,
            type: resolved.type,
            values: resolved.values,
          });
        }
      }
    }
  }

  // Third pass: emit standalone flat objects (exported, not consumed by composites)
  for (const sf of sourceFiles) {
    if (sf.getBaseName() === 'index.ts') continue;

    for (const varDecl of sf.getVariableDeclarations()) {
      if (!varDecl.isExported()) continue;

      const name = varDecl.getName();
      const init = varDecl.getInitializer();
      if (!init || init.getKind() !== SyntaxKind.SatisfiesExpression) continue;

      if (!consumed.has(name)) {
        const flat = flatObjects.get(name);
        if (flat) categories.push(flat);
      }
    }
  }

  return categories.sort((a, b) => a.name.localeCompare(b.name));
}

function extractObjectValues(obj: import('ts-morph').ObjectLiteralExpression): Record<string, string> {
  const result: Record<string, string> = {};

  for (const prop of obj.getProperties()) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const pa = prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
    const key = pa.getName().replace(/^['"]|['"]$/g, '');
    const initNode = pa.getInitializer();
    if (!initNode) continue;

    // Extract string literal values
    if (initNode.getKind() === SyntaxKind.StringLiteral) {
      result[key] = initNode.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
    } else if (initNode.getKind() === SyntaxKind.NumericLiteral) {
      result[key] = initNode.getText();
    } else {
      // Non-literal (expression, reference) — store the source text as description
      result[key] = initNode.getText();
    }
  }

  return result;
}
