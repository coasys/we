import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

import type { ModelEntry, ModelFieldEntry, ModelRelationEntry } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract block and entity models from @we/models source files.
 * Parses @Model, @Property, @HasMany decorators using ts-morph.
 */
export function extractModels(modelsDir?: string): ModelEntry[] {
  const dir = modelsDir ?? resolve(__dirname, '../../../../models/src');

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths([`${dir}/blocks/*.ts`, `${dir}/entities/*.ts`, `${dir}/WeNode.ts`]);

  const entries: ModelEntry[] = [];

  for (const sf of project.getSourceFiles()) {
    if (sf.getBaseName() === 'index.ts') continue;

    for (const cls of sf.getClasses()) {
      const modelDeco = cls.getDecorator('Model');
      if (!modelDeco) continue;

      const modelName = extractDecoratorStringOption(modelDeco, 'name') ?? cls.getName() ?? 'Unknown';
      const extendsClause = cls.getExtends()?.getText();

      const fields: ModelFieldEntry[] = [];
      const relations: ModelRelationEntry[] = [];

      for (const prop of cls.getProperties()) {
        const propDeco = prop.getDecorator('Property');
        const hasManyDeco = prop.getDecorator('HasMany');
        const hasOneDeco = prop.getDecorator('HasOne');

        if (propDeco) {
          const through = extractDecoratorStringOption(propDeco, 'through') ?? '';
          const required = extractDecoratorBooleanOption(propDeco, 'required') ?? false;
          const initial = extractDecoratorStringOption(propDeco, 'initial');

          fields.push({
            name: prop.getName(),
            type: prop.getType().getText(prop),
            predicate: through,
            required,
            default: initial ?? getPropertyDefault(prop),
          });
        } else if (hasManyDeco) {
          const through = extractDecoratorStringOption(hasManyDeco, 'through') ?? '';
          const target = extractHasManyTarget(hasManyDeco);

          relations.push({
            name: prop.getName(),
            kind: 'HasMany',
            predicate: through,
            target,
          });
        } else if (hasOneDeco) {
          const through = extractDecoratorStringOption(hasOneDeco, 'through') ?? '';

          relations.push({
            name: prop.getName(),
            kind: 'HasOne',
            predicate: through,
          });
        }
      }

      entries.push({
        name: modelName,
        className: cls.getName() ?? modelName,
        extends: extendsClause,
        fields,
        relations,
      });
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract a string value from a decorator option object.
 * Handles both `@Decorator({ key: 'value' })` patterns.
 */
function extractDecoratorStringOption(decorator: import('ts-morph').Decorator, key: string): string | undefined {
  for (const arg of decorator.getArguments()) {
    if (arg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
    const obj = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const prop = obj.getProperty(key);
    if (!prop || prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (init?.getKind() === SyntaxKind.StringLiteral) {
      return init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
    }
  }
  return undefined;
}

function extractDecoratorBooleanOption(decorator: import('ts-morph').Decorator, key: string): boolean | undefined {
  for (const arg of decorator.getArguments()) {
    if (arg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
    const obj = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const prop = obj.getProperty(key);
    if (!prop || prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (init?.getText() === 'true') return true;
    if (init?.getText() === 'false') return false;
  }
  return undefined;
}

/**
 * Extract target type from @HasMany(() => Template, { through: ... }) pattern.
 * The first arg may be an arrow function returning the target class.
 */
function extractHasManyTarget(decorator: import('ts-morph').Decorator): string | undefined {
  const args = decorator.getArguments();
  if (args.length === 0) return undefined;
  const first = args[0];
  // Arrow function: () => Template
  if (first.getKind() === SyntaxKind.ArrowFunction) {
    const body = first.asKindOrThrow(SyntaxKind.ArrowFunction).getBody();
    return body.getText();
  }
  return undefined;
}

function getPropertyDefault(prop: import('ts-morph').PropertyDeclaration): string | undefined {
  const init = prop.getInitializer();
  if (!init) return undefined;
  const text = init.getText();
  // Skip empty defaults like '', 0, [], {}
  if (text === "''" || text === '""' || text === '0' || text === '[]' || text === '{}') return undefined;
  return text;
}
