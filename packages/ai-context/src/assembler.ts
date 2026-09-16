import type {
  AssembledContext,
  ComponentEntry,
  EntityEntry,
  ModuleCatalogEntry,
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

  // Feature modules — the deployment's, with everything a schema may name of each. After the stores,
  // since `modules.<id>.*` reads like one more store, and before the patterns that place their parts.
  if (context.modules?.length) {
    sections.push(formatModules(context.modules));
  }

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

/**
 * A docblock as a registry entry's description — its own headings demoted out of the way.
 *
 * A primitive's docblock is prose written for whoever opens the file, and several of them use `##`
 * to organise a long explanation. Emitted verbatim into this reference those become **top-level
 * headings of the reference itself**: `we-draggable` and `we-drop-zone` alone contributed fifteen,
 * so `AGENTS.md` claimed sections called "Keyboard", "One element, not two" and "It emits intent,
 * it never mutates" between "Component Registry" and "Design System Props". Anything reading the
 * document by heading — a person scanning it, a tool chunking it — reads that as structure.
 *
 * Demoted rather than stripped: the prose is worth keeping and its shape is part of the meaning.
 * Two levels down puts a component's own sections below the registry entry they belong to.
 */
function demoteHeadings(text: string): string {
  return text.replace(/^(#{1,4}) /gm, (_match, hashes: string) => `${'#'.repeat(Math.min(hashes.length + 2, 6))} `);
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
      const desc = prim.description ? ` — ${demoteHeadings(prim.description)}` : '';
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
      const desc = comp.description ? ` — ${demoteHeadings(comp.description)}` : '';
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
      const desc = w.description ? ` — ${demoteHeadings(w.description)}` : '';
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
  const lines: string[] = [
    '## Block & Entity Models',
    '',
    'Available data models for $query and store data:',
    '',
    /*
      One field needs a sentence the listing cannot carry.

      The listing emits names, types and predicates — the manifest's own docblocks are prose in the
      source and never reach here — which is fine for `title: string` and leaves `marks: json`
      meaning nothing. It is the field a text block's entire inline structure lives in, so a schema
      author reading this had a name, a type of `json`, and no way to find out what is in it.
    */
    'A `json` field is a stored blob rather than a queryable value. `TextBlock.marks` is the one worth',
    'knowing: it holds inline structure over `text` as standoff annotations — a JSON array of',
    '`{ start, end, type, ...data }` ranges, offsets in Unicode **code points** — with types `strong`,',
    '`em`, `underline`, `strike`, `code`, `link` (`href`), `nodeLink` and `mention` (`did`). A block',
    'with `text` and no `marks` is one unmarked span, which is why a transcriber can write a',
    'well-formed block without knowing marks exist. Render from it; never filter on it — anything',
    'queryable is written beside it as a relation (a mention is also a `we://mention` link on the root,',
    'which is where "who is named in this post" is answered).',
  ];

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

/**
 * The feature modules, one block each: what it needs, what a template may read and call, what it
 * lets a template place, and what it adds to the vocabulary.
 *
 * Generated from the definitions rather than written, for the reason every catalogue here is: a
 * module's public surface is decided by the module (`deps.state` / `deps.action`, `contributes.*`),
 * and a hand-kept list would be a second source that drifts. Members carry the sentence they were
 * marked with, so a store member reaches an author with its meaning, as host store members do.
 */
function formatModules(modules: ModuleCatalogEntry[]): string {
  const lines: string[] = [
    '## Feature Modules',
    '',
    'The modules this deployment ships. A module publishes a store at `modules.<id>` (public members only),',
    'parts a template places with `{ "type": "$part", "props": { "id": "<id>.<part>" } }`, panels a',
    'template places or supplies through `meta.panels` (`{ "module": "<id>", "dock": "<panel>" }`), and',
    'functions expressions call like the host functions above. A template that reaches a module by name',
    'declares it: `meta.requires.modules: ["<id>"]`. Reading `{ "$": "modules.<id>" }` bare is how a template',
    'depends on a module that may not be installed.',
  ];

  for (const mod of modules) {
    lines.push('');
    lines.push(`### ${mod.name} (\`${mod.id}\`)${mod.scope === 'agent' ? ' — the agent’s, not a space’s' : ''}`);
    if (mod.description) lines.push(mod.description);
    const needs: string[] = [];
    if (mod.requires.kernels?.length) needs.push(`kernels ${mod.requires.kernels.join(', ')}`);
    if (mod.requires.permissions?.length) needs.push(`permissions ${mod.requires.permissions.join(', ')}`);
    if (mod.requires.backends?.length) needs.push(`backends ${mod.requires.backends.join(', ')}`);
    if (needs.length) lines.push(`Needs: ${needs.join('; ')}.`);

    if (mod.members.length) {
      const state = mod.members.filter((m) => m.kind === 'state');
      const actions = mod.members.filter((m) => m.kind === 'action');
      if (state.length) {
        lines.push(`- State (read in an expression as \`modules.${mod.id}.<name>\`):`);
        for (const m of state) lines.push(`  - ${m.name} — ${m.doc}`);
      }
      if (actions.length) {
        lines.push(`- Actions (\`{ "$action": "modules.${mod.id}.<name>" }\`):`);
        for (const m of actions) lines.push(`  - ${m.name} — ${m.doc}`);
      }
    } else {
      lines.push('- No store: everything this module does is declared.');
    }
    if (mod.parts.length) {
      lines.push(
        `- Parts: ${mod.parts.map((p) => `\`${mod.id}.${p.name}\`${p.subject ? ` (subject: ${p.subject})` : ''}`).join(', ')}`,
      );
    }
    if (mod.panels.length) {
      lines.push(
        `- Panels (\`meta.panels[].dock\`): ${mod.panels.map((p) => `\`${p.name}\` "${p.title}"${p.hostOwned ? '' : ' (module-owned openness)'}`).join(', ')}`,
      );
    }
    if (mod.settings.length) {
      lines.push(
        `- Settings: ${mod.settings.map((s) => `\`${s.key}\` (${s.type}; ${s.levels.join(', ')}) — ${s.label}`).join('; ')}`,
      );
    }
    if (Object.keys(mod.activities).length) {
      lines.push(
        `- Presence activities: ${Object.entries(mod.activities)
          .map(
            ([type, shape]) =>
              `\`${type}\` { ${Object.entries(shape)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ')} }`,
          )
          .join('; ')}`,
      );
    }
    if (mod.components.length) lines.push(`- Components: ${mod.components.join(', ')}`);
    if (mod.functions.length) {
      lines.push('- Functions:');
      for (const fn of mod.functions)
        lines.push(`  - ${fn.name}(${fn.params.join(', ')}) — ${fn.doc}  e.g. ${fn.example}`);
    }
    if (mod.views.length) {
      lines.push(
        `- Views (sections a space enables): ${mod.views.map((v) => `\`${v.id}\` "${v.name}"${v.segment ? ` at /${v.segment}` : ''}`).join(', ')}`,
      );
    }
    if (mod.blocks.length) {
      lines.push(
        `- Blocks: ${mod.blocks.map((b) => `${b.entity} (\`_type: "${b.nodeType}"\`, drawn by \`${mod.id}.${b.card}\`)`).join(', ')}`,
      );
    }
    if (mod.entities.length) {
      lines.push('- Entities (queryable with $query):');
      for (const entity of mod.entities) {
        const fields = entity.fields.map((f) => `${f.name}: ${f.type}${f.required ? ' (required)' : ''}`).join(', ');
        const relations = entity.relations
          .map((r) => `${r.name}: ${r.kind}${r.target ? ` → ${r.target}` : ''}`)
          .join(', ');
        lines.push(
          `  - ${entity.name}${entity.extends ? ` extends ${entity.extends}` : ''}: ${fields}${relations ? `; relations ${relations}` : ''}`,
        );
      }
    }
  }
  return lines.join('\n');
}
