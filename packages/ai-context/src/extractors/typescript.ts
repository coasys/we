import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Project } from 'ts-morph';

import type { ComponentEntry, PropEntry } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract component/widget interfaces from *.types.ts files using ts-morph.
 * Reads @ai JSDoc tags for descriptions.
 */
export function extractComponents(baseDirs?: { components?: string; widgets?: string }): ComponentEntry[] {
  const componentDir = baseDirs?.components ?? resolve(__dirname, '../../../../design-system/4-components/src');
  const widgetDir = baseDirs?.widgets ?? resolve(__dirname, '../../../../design-system/5-widgets/src');

  const project = new Project({ skipAddingFilesFromTsConfig: true });

  const entries: ComponentEntry[] = [
    ...extractFromDir(project, componentDir, 'components'),
    ...extractFromDir(project, widgetDir, 'widgets'),
  ];

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function extractFromDir(project: Project, dir: string, source: 'components' | 'widgets'): ComponentEntry[] {
  const sourceFiles = project.addSourceFilesAtPaths(`${dir}/**/*.types.ts`);
  const entries: ComponentEntry[] = [];

  for (const sourceFile of sourceFiles) {
    for (const iface of sourceFile.getInterfaces()) {
      const name = iface.getName();
      if (!name.endsWith('Props')) continue;

      const componentName = name.replace(/Props$/, '');
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
