import type {
  AssembledContext,
  ComponentEntry,
  EntityEntry,
  PluginCatalog,
  PrimitiveEntry,
  TokenCategory,
} from './types.js';

/**
 * Assemble a formatted text reference from structured context.
 * Returns facts only — no framing or persona instructions.
 * Consumers add their own intent (generate script adds instruction-file framing,
 * in-app AI adds chat framing).
 */
export function assembleReference(ctx: AssembledContext): string {
  const context = ctx;
  const sections: string[] = [];

  // Schema operators (structure, dynamic logic, block structures)
  sections.push(context.fragments.schemaOperators.trim());

  // Component registry
  sections.push(formatComponentRegistry(context.primitives, context.components));

  // Sub-registries a component resolves by name. Immediately after the component registry, because
  // the props above are unusable without them: `layout.type` is documented as a string, and the names
  // that string may hold live here.
  if (context.pluginCatalogs?.length) {
    sections.push(formatPluginCatalogs(context.pluginCatalogs));
  }

  // Design system props (inherited by all primitives)
  sections.push(context.fragments.designSystemProps.trim());

  // Design tokens
  sections.push(formatTokens(context.tokens));

  // Models
  if (context.models.length > 0) {
    sections.push(formatEntities(context.models));
  }

  // Stores
  sections.push(context.fragments.stores.trim());

  // Store patterns
  sections.push(context.fragments.storePatterns.trim());

  // Ready-made shapes. After the stores and their patterns — a recipe names both, so it only reads
  // once the vocabulary underneath it has been introduced — and before the rules, which are the
  // short prohibitions a reader should meet last.
  sections.push(context.fragments.patterns.trim());

  // Routing
  sections.push(context.fragments.routing.trim());

  // Panels. After routing, because a section's own layout is read against the routes it renders at,
  // and before the rules — the panel-versus-flow test is guidance rather than a prohibition.
  sections.push(context.fragments.panels.trim());

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
      const superHint = comp.superclass ? ` (${comp.superclass})` : '';
      lines.push(`- ${comp.name}${superHint}${desc}`);
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
      const superHint = w.superclass ? ` (${w.superclass})` : '';
      lines.push(`- ${w.name}${superHint}${desc}`);
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

/**
 * Component plugin registries, grouped by the slot a name plugs into.
 *
 * Grouped by category rather than listed flat because the question an author has is always
 * "what can `layout.type` be?", never "what plugins exist?".
 */
function formatPluginCatalogs(catalogs: PluginCatalog[]): string {
  const lines: string[] = ['## Component Plugin Registries', ''];
  lines.push(
    'Some components resolve named plugins from their props. These are the names each accepts —',
    'a name not listed here does not exist, and the component will warn rather than render.',
    '',
  );

  for (const catalog of catalogs) {
    lines.push(`### ${catalog.component}`);
    if (catalog.description) lines.push('', catalog.description);

    const categories = [...new Set(catalog.plugins.map((p) => p.category))];
    for (const category of categories) {
      lines.push('', `**${category}**`, '');
      for (const plugin of catalog.plugins.filter((p) => p.category === category)) {
        lines.push(`- \`${plugin.id}\`${plugin.description ? ` — ${plugin.description}` : ''}`);
        for (const option of plugin.options ?? []) {
          const note = option.description ? ` — ${option.description}` : '';
          lines.push(`  - ${option.name}: ${option.type}${note}`);
        }
        if (plugin.example) lines.push(`  - Example: \`${plugin.example}\``);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim();
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

function formatEntities(models: EntityEntry[]): string {
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
