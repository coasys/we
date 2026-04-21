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
      // e.g. "CircleButtonProps", "DropdownMenuProps", "SomeComponentProps<T>"
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
      const superclassTag = getSuperclassTag(fn, paramType);

      // When a superclass is declared, filter out props that belong to that
      // superclass so only own/specific props are stored (mirrors how
      // PrimitiveEntry.ownProps works for web components).
      const ownProps = superclassTag ? filterOwnProps(props) : props;

      entries.push({
        name,
        description: aiTag || undefined,
        superclass: superclassTag || undefined,
        props: ownProps,
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

/** Look for a @superclass JSDoc tag on the function or Props type declaration. */
function getSuperclassTag(fn: FunctionDeclaration, paramType: Type): string | undefined {
  const tag = getTagFromJsDocs(fn.getJsDocs(), 'superclass');
  if (tag) return tag;

  const sym = paramType.getSymbol() ?? paramType.getAliasSymbol();
  for (const decl of sym?.getDeclarations() ?? []) {
    if (Node.isInterfaceDeclaration(decl) || Node.isTypeAliasDeclaration(decl)) {
      const typeTag = getTagFromJsDocs(decl.getJsDocs(), 'superclass');
      if (typeTag) return typeTag;
    }
  }

  return undefined;
}

/**
 * When a superclass is declared, filter out props whose names belong to the
 * design system base — those are inherited and documented separately in the
 * AI context under "Design System Props".
 */
function filterOwnProps(props: PropEntry[]): PropEntry[] {
  return props.filter((p) => !DS_PROP_NAMES.has(p.name));
}

// Canonical set of DesignSystemProps property names — kept in sync with @we/design-types.
// When superclass is set, these are omitted from own props (documented separately).
const DS_PROP_NAMES = new Set([
  'bg',
  'color',
  'opacity',
  'border',
  'borderColor',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'borderWidth',
  'shadow',
  'ring',
  'transform',
  'transition',
  'textAlign',
  'fontFamily',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textDecoration',
  'textTransform',
  'cursor',
  'pointerEvents',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'display',
  'direction',
  'ax',
  'ay',
  'wrap',
  'gap',
  'flex',
  'alignSelf',
  'overflow',
  'zIndex',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'm',
  'ml',
  'mr',
  'mt',
  'mb',
  'mx',
  'my',
  'p',
  'pl',
  'pr',
  'pt',
  'pb',
  'px',
  'py',
  'r',
  'rt',
  'rb',
  'rl',
  'rr',
  'rtl',
  'rtr',
  'rbr',
  'rbl',
  'hoverProps',
  'activeProps',
  'focusProps',
  'disabledProps',
]);

function getAiTagFromJsDocs(jsDocs: JSDoc[]): string | undefined {
  return getTagFromJsDocs(jsDocs, 'ai');
}

function getTagFromJsDocs(jsDocs: JSDoc[], tagName: string): string | undefined {
  for (const jsDoc of jsDocs) {
    for (const tag of jsDoc.getTags()) {
      if (tag.getTagName() === tagName) return tag.getCommentText()?.trim();
    }
  }
  return undefined;
}
