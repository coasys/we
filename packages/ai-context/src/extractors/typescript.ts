import { resolve } from 'node:path';

import type { FunctionDeclaration, JSDoc, Type } from 'ts-morph';
import { Node, Project } from 'ts-morph';

import type { ComponentEntry, PropEntry } from '../types.js';

/**
 * Extract component props by scanning for exported PascalCase function declarations
 * whose first parameter is typed with a `*Props` interface or type alias.
 *
 * Works for any package structure — no `.types.ts` convention required.
 * Props are resolved via ts-morph regardless of where the type is defined
 * (same file, separate .types.ts file, or another package entirely).
 *
 * @param dir — absolute path to the source directory to scan
 * @param source — label to stamp on each ComponentEntry ('components' | 'widgets')
 */
export function extractComponentProps(dir: string, source: 'components' | 'widgets'): ComponentEntry[] {
  // Use the package's tsconfig so ts-morph can resolve workspace imports
  // (e.g. @we/design-types, @we/design-utils/solid) via bundler module resolution
  const tsConfigFilePath = resolve(dir, '..', 'tsconfig.json');
  const project = new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: true });

  return extractFromDir(project, dir, source).sort((a, b) => a.name.localeCompare(b.name));
}

function extractFromDir(project: Project, dir: string, source: 'components' | 'widgets'): ComponentEntry[] {
  const sourceFiles = project.addSourceFilesAtPaths([`${dir}/**/*.ts`, `${dir}/**/*.tsx`]);
  const entries: ComponentEntry[] = [];
  const seen = new Set<string>();

  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();
    // Skip test, spec, and story files
    if (/\.(test|spec|stories)\./i.test(filePath)) continue;

    for (const fn of sourceFile.getFunctions()) {
      if (!fn.isExported()) continue;

      const name = fn.getName();
      if (!name || !/^[A-Z]/.test(name)) continue;
      if (seen.has(name)) continue;

      const firstParam = fn.getParameters()[0];
      if (!firstParam) continue;

      // Check the type annotation text — works for both regular and destructured params
      // e.g. "CircleButtonProps", "BlockComposerProps", "PopoverMenuProps<T>"
      const typeAnnotation = firstParam.getTypeNode()?.getText();
      if (!typeAnnotation || !/Props(?:$|<)/.test(typeAnnotation)) continue;

      const paramType = firstParam.getType();

      seen.add(name);

      const props: PropEntry[] = [];
      for (const sym of paramType.getProperties()) {
        const decl = sym.getDeclarations()[0];
        if (!decl) continue;
        // Only include props declared in workspace source, not from
        // framework types (e.g. JSX.HTMLAttributes from solid-js/react)
        const declPath = decl.getSourceFile().getFilePath();
        if (declPath.includes('/node_modules/')) continue;

        let typeText = sym.getTypeAtLocation(decl).getText(decl);
        const optional = !!(sym.getFlags() & 16777216); // ts.SymbolFlags.Optional
        if (optional) typeText = typeText.replace(/ \| undefined$/, '');
        props.push({ name: sym.getName(), type: typeText, optional, default: undefined });
      }

      const aiTag = getAiDescription(fn, paramType);

      entries.push({
        name,
        description: aiTag || undefined,
        props,
        source,
      });
    }
  }

  return entries;
}

/** Look for an @ai JSDoc tag on the function, then fall back to the Props type declaration. */
function getAiDescription(fn: FunctionDeclaration, paramType: Type): string | undefined {
  const fnAi = getAiTagFromJsDocs(fn.getJsDocs());
  if (fnAi) return fnAi;

  const sym = paramType.getSymbol() ?? paramType.getAliasSymbol();
  for (const decl of sym?.getDeclarations() ?? []) {
    if (Node.isInterfaceDeclaration(decl) || Node.isTypeAliasDeclaration(decl)) {
      const typeAi = getAiTagFromJsDocs(decl.getJsDocs());
      if (typeAi) return typeAi;
    }
  }

  return undefined;
}

function getAiTagFromJsDocs(jsDocs: JSDoc[]): string | undefined {
  for (const jsDoc of jsDocs) {
    for (const tag of jsDoc.getTags()) {
      if (tag.getTagName() === 'ai') return tag.getCommentText()?.trim();
    }
  }
  return undefined;
}
