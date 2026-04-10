import type { ContextData } from '@we/schema-shared';

import { extractPrimitives } from './extractors/cem.js';
import { extractModels } from './extractors/models.js';
import { extractTokens } from './extractors/tokens.js';
import { extractComponents } from './extractors/typescript.js';
import { designSystemProps } from './fragments/design-system-props.js';
import { routing } from './fragments/routing.js';
import { rules } from './fragments/rules.js';
import { schemaOperators } from './fragments/schema-operators.js';
import { storePatterns } from './fragments/store-patterns.js';
import { storeEntries, stores } from './fragments/stores.js';
import type { AssembledContext, ComponentEntry, ModelEntry, PrimitiveEntry, TokenCategory } from './types.js';

/**
 * Assemble the full structured context.
 * If contextData is provided, uses it directly (from glob-based discovery).
 * Otherwise falls back to calling extractors with defaults.
 */
export function assembleContext(contextData?: ContextData): AssembledContext {
  const data = contextData ?? {
    primitives: extractPrimitives(),
    components: extractComponents(),
    models: extractModels(),
    tokens: extractTokens(),
    storeEntries,
  };
  return {
    ...data,
    fragments: {
      schemaOperators,
      designSystemProps,
      routing,
      stores,
      storePatterns,
      rules,
    },
  };
}

/**
 * Assemble a formatted text reference from structured context.
 * Returns facts only — no framing or persona instructions.
 * Consumers add their own intent (generate script adds instruction-file framing,
 * in-app AI adds chat framing).
 */
export function assembleReference(ctx?: AssembledContext): string {
  const context = ctx ?? assembleContext();
  const sections: string[] = [];

  // Schema operators (structure, dynamic logic, block structures)
  sections.push(context.fragments.schemaOperators.trim());

  // Component registry
  sections.push(formatComponentRegistry(context.primitives, context.components));

  // Design system props (inherited by all primitives)
  sections.push(context.fragments.designSystemProps.trim());

  // Design tokens
  sections.push(formatTokens(context.tokens));

  // Models
  if (context.models.length > 0) {
    sections.push(formatModels(context.models));
  }

  // Stores
  sections.push(context.fragments.stores.trim());

  // Store patterns
  sections.push(context.fragments.storePatterns.trim());

  // Routing
  sections.push(context.fragments.routing.trim());

  // Rules
  sections.push(context.fragments.rules.trim());

  return sections.join('\n\n---\n\n');
}

function formatComponentRegistry(primitives: PrimitiveEntry[], components: ComponentEntry[]): string {
  const lines: string[] = [
    '## Component Registry',
    '',
    'Most @we/primitives also accept Design System Props (see next section for details and exceptions).',
  ];

  // Primitives
  if (primitives.length > 0) {
    lines.push('');
    lines.push('@we/primitives:');
    for (const prim of primitives) {
      const propList = prim.ownProps.map((p) => {
        const opt = p.optional ? '?' : '';
        const def = p.default ? ` = ${p.default}` : '';
        return `${p.name}${opt}: ${p.type}${def}`;
      });
      const superHint = prim.superclass ? ` (${prim.superclass})` : '';
      const desc = prim.description ? ` — ${prim.description}` : '';
      lines.push(`- ${prim.tagName}${superHint}${desc}`);
      if (propList.length > 0) {
        lines.push(`  Props: ${propList.join(', ')}`);
      }
    }
  }

  // Components
  const comps = components.filter((c) => c.source === 'components');
  if (comps.length > 0) {
    lines.push('');
    lines.push('@we/components:');
    for (const comp of comps) {
      const desc = comp.description ? ` — ${comp.description}` : '';
      lines.push(`- ${comp.name}${desc}`);
      if (comp.props.length > 0) {
        const propList = comp.props.map((p) => {
          const opt = p.optional ? '?' : '';
          return `${p.name}${opt}: ${p.type}`;
        });
        lines.push(`  Props: ${propList.join(', ')}`);
      }
    }
  }

  // Widgets
  const widgets = components.filter((c) => c.source === 'widgets');
  if (widgets.length > 0) {
    lines.push('');
    lines.push('@we/widgets:');
    for (const w of widgets) {
      const desc = w.description ? ` — ${w.description}` : '';
      lines.push(`- ${w.name}${desc}`);
      if (w.props.length > 0) {
        const propList = w.props.map((p) => {
          const opt = p.optional ? '?' : '';
          return `${p.name}${opt}: ${p.type}`;
        });
        lines.push(`  Props: ${propList.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

function formatTokens(tokens: TokenCategory[]): string {
  const lines: string[] = [
    '## Design Tokens',
    '',
    'Use design tokens for spacing, color, radius, etc. Do not use raw CSS values unless using the styles prop.',
  ];

  for (const cat of tokens) {
    const keys = Object.keys(cat.values);
    lines.push('');
    lines.push(`${cat.name}: ${keys.map((k) => `'${k}'`).join(', ')}`);
  }

  return lines.join('\n');
}

function formatModels(models: ModelEntry[]): string {
  const lines: string[] = ['## Block & Entity Models', '', 'Available data models for $query and store data:'];

  for (const model of models) {
    const ext = model.extends ? ` extends ${model.extends}` : '';
    lines.push('');
    lines.push(`${model.name}${ext}:`);

    if (model.fields.length > 0) {
      lines.push('  Fields:');
      for (const f of model.fields) {
        const req = f.required ? ' (required)' : '';
        const def = f.default ? ` = ${f.default}` : '';
        lines.push(`  - ${f.name}: ${f.type}${req}${def} [${f.predicate}]`);
      }
    }

    if (model.relations.length > 0) {
      lines.push('  Relations:');
      for (const r of model.relations) {
        const target = r.target ? ` → ${r.target}` : '';
        lines.push(`  - ${r.name}: ${r.kind}${target} [${r.predicate}]`);
      }
    }
  }

  return lines.join('\n');
}
