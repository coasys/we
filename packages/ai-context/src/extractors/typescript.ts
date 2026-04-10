import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Project } from 'ts-morph';

import type { ComponentEntry, PropEntry } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract component/widget interfaces from *.types.ts files using ts-morph.
 * Reads @ai JSDoc tags for descriptions.
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

/**
 * @deprecated Use extractComponentProps(dir, source) instead.
 * Kept for backward compatibility with tests during migration.
 */
export function extractComponents(baseDirs?: { components?: string; widgets?: string }): ComponentEntry[] {
  const componentDir = baseDirs?.components ?? resolve(__dirname, '../../../../design-system/4-components/src');
  const widgetDir = baseDirs?.widgets ?? resolve(__dirname, '../../../../design-system/5-widgets/src');

  return [...extractComponentProps(componentDir, 'components'), ...extractComponentProps(widgetDir, 'widgets')].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
}

function extractFromDir(project: Project, dir: string, source: 'components' | 'widgets'): ComponentEntry[] {
  const sourceFiles = project.addSourceFilesAtPaths(`${dir}/**/*.types.ts`);
  const entries: ComponentEntry[] = [];

  for (const sourceFile of sourceFiles) {
    // The file's base name determines which component it belongs to
    // e.g. Dialog.types.ts → "Dialog", CollapsibleSidebar.types.ts → "CollapsibleSidebar"
    const fileName = sourceFile.getBaseNameWithoutExtension().replace(/\.types$/, '');

    // Extract from interfaces (e.g. export interface DialogProps { ... })
    for (const iface of sourceFile.getInterfaces()) {
      const name = iface.getName();
      if (!name.endsWith('Props')) continue;

      const componentName = name.replace(/Props$/, '');
      // Skip helper types that don't match the file name (e.g. AvatarProps in CollapsibleSidebar.types.ts)
      if (componentName !== fileName) continue;
      const aiTag = getAiTag(iface);

      const props: PropEntry[] = iface.getProperties().map((prop) => ({
        name: prop.getName(),
        type: prop.getType().getText(prop),
        optional: prop.hasQuestionToken(),
        default: undefined,
      }));

      entries.push({
        name: componentName,
        description: aiTag || undefined,
        props,
        source,
      });
    }

    // Extract from type aliases (e.g. export type ColumnProps = Omit<...> & { ... })
    for (const typeAlias of sourceFile.getTypeAliases()) {
      const name = typeAlias.getName();
      if (!name.endsWith('Props')) continue;
      const componentName = name.replace(/Props$/, '');
      // Skip helper types that don't match the file name
      if (componentName !== fileName) continue;
      // Skip if we already found an interface with the same name
      if (entries.some((e) => e.name === componentName)) continue;

      const resolvedType = typeAlias.getType();
      const props: PropEntry[] = [];
      for (const sym of resolvedType.getProperties()) {
        const decl = sym.getDeclarations()[0];
        if (!decl) continue;
        // Only include props declared in workspace source, not from
        // framework types (e.g. JSX.HTMLAttributes from solid-js/react)
        const declPath = decl.getSourceFile().getFilePath();
        if (declPath.includes('/node_modules/')) continue;

        const typeText = sym.getTypeAtLocation(decl).getText(decl);
        const optional = !!(sym.getFlags() & 16777216); // ts.SymbolFlags.Optional
        props.push({ name: sym.getName(), type: typeText, optional, default: undefined });
      }

      const aiTag = getAiTagFromTypeAlias(typeAlias);

      entries.push({
        name: componentName,
        description: aiTag || undefined,
        props,
        source,
      });
    }
  }

  return entries;
}

function getAiTag(iface: ReturnType<import('ts-morph').SourceFile['getInterfaces']>[0]): string | undefined {
  for (const jsDoc of iface.getJsDocs()) {
    for (const tag of jsDoc.getTags()) {
      if (tag.getTagName() === 'ai') {
        return tag.getCommentText()?.trim();
      }
    }
  }
  return undefined;
}

function getAiTagFromTypeAlias(
  typeAlias: ReturnType<import('ts-morph').SourceFile['getTypeAliases']>[0],
): string | undefined {
  for (const jsDoc of typeAlias.getJsDocs()) {
    for (const tag of jsDoc.getTags()) {
      if (tag.getTagName() === 'ai') {
        return tag.getCommentText()?.trim();
      }
    }
  }
  return undefined;
}
