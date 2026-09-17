/**
 * contextStrategies — what the template editor's model is told about WE, three ways.
 *
 * The generated schema reference is ~87K tokens, and every request sends all of it. That is right
 * for a large model with prompt caching and possibly wrong for a small one, and which of those holds
 * is a question for measurement (see `eval/`), not argument. These are the candidates, built as pure
 * functions over the same generated text, so they differ only in how the text is delivered:
 *
 * - **full** — the whole reference in the system prompt. What the editor ships.
 * - **sections** — a core in the system prompt and the rest behind one tool per section, the model
 *   loading what it decides it needs. Josh's split from #196: his core, his tool names, his grouping,
 *   applied to the reference as it is today.
 * - **lookup** — a larger core (the expression grammar and design-system props, which almost every
 *   edit needs), the entries the request already implicates preselected into the prompt, and one
 *   tool that fetches individual components, stores or sections by name rather than whole sections.
 *
 * Splitting the generated text at run time, rather than generating the pieces, keeps one artifact:
 * a strategy cannot drift from the reference it is cut from, and nothing ships for an experiment.
 */
import type { ConversationTool, ConversationToolCall } from '@we/backend-shared';
import type { SchemaNode } from '@we/schema-shared';

export type ContextStrategyId = 'full' | 'sections' | 'lookup';

export const CONTEXT_STRATEGIES: ContextStrategyId[] = ['full', 'sections', 'lookup'];

export interface PreparedContext {
  system: string;
  tools: ConversationTool[];
  resolveTool?: (call: ConversationToolCall) => string | undefined;
}

export interface ReferenceSection {
  /** The `## ` heading, without the hashes. */
  title: string;
  /** The section's whole text, heading included. */
  text: string;
}

/**
 * The reference, cut at its `## ` headings.
 *
 * Every line lands in exactly one section, in order, so joining the texts gives the reference back.
 * Text before the first heading, if any, is a section with an empty title.
 */
export function splitReference(reference: string): ReferenceSection[] {
  const sections: ReferenceSection[] = [];
  let current: { title: string; lines: string[] } = { title: '', lines: [] };
  for (const line of reference.split('\n')) {
    if (line.startsWith('## ')) {
      if (current.lines.length) sections.push({ title: current.title, text: current.lines.join('\n') });
      current = { title: line.slice(3).trim(), lines: [] };
    }
    current.lines.push(line);
  }
  sections.push({ title: current.title, text: current.lines.join('\n') });
  return sections;
}

/** The reference's sections by title, failing loudly on one that has been renamed. */
function sectionsByTitle(reference: string) {
  const byTitle = new Map(splitReference(reference).map((s) => [s.title, s.text]));
  return (title: string): string => {
    const text = byTitle.get(title);
    if (text === undefined) {
      throw new Error(`The schema reference has no section "${title}" — contextStrategies needs updating`);
    }
    return text;
  };
}

const CORE_TITLES = [
  'Schema Structure',
  'Rules & Best Practices',
  'Schema Validation',
  'Routing Structure',
  'Block & Entity Models',
  'Design Tokens',
];

/** Josh's sections, by tool name. Feature Modules postdates #196 and gets a tool of its own. */
const SECTION_TOOLS: { name: string; summary: string; titles: string[] }[] = [
  {
    name: 'we_stores_reference',
    summary: 'Store members, computed state, actions, and access patterns',
    titles: ['Stores'],
  },
  {
    name: 'we_schema_operators',
    summary: 'The expression language, handlers, queries, local state and block-level structures',
    titles: ['Prop-level Dynamic Logic & Expressions', 'Block-level Dynamic Structures'],
  },
  {
    name: 'we_component_registry',
    summary: 'Primitive and component tags with props, slots, and descriptions',
    titles: ['Component Registry'],
  },
  {
    name: 'we_common_patterns',
    summary: 'Ready-made layout and form template recipes',
    titles: ['Common Patterns (copy these shapes)'],
  },
  {
    name: 'we_design_props',
    summary: 'Design system property tables inherited by all primitives',
    titles: ['Design System Props'],
  },
  {
    name: 'we_plugin_registries',
    summary: 'Plugin catalogues and named-plugin configuration options',
    titles: ['Component Plugin Registries'],
  },
  { name: 'we_store_patterns', summary: 'Store creation and usage patterns', titles: ['Store Usage Patterns'] },
  { name: 'we_panels', summary: 'Panel types, configuration, and section layout', titles: ['Panels'] },
  {
    name: 'we_feature_modules',
    summary: 'Feature modules, their stores, parts and panels',
    titles: ['Feature Modules'],
  },
];

const NO_PARAMETERS = { type: 'object', properties: {} };

export function fullContext(preamble: string, reference: string): PreparedContext {
  return { system: preamble + reference, tools: [] };
}

export function sectionsContext(preamble: string, reference: string): PreparedContext {
  const section = sectionsByTitle(reference);
  const directory = [
    '## Available Context Tools',
    '',
    'The reference above is only the core. Call these tools to load the rest — each returns one section.',
    'Load the sections a change needs before writing patches; guessing a component, prop or store is the',
    'most common reason a patch fails validation.',
    '',
    ...SECTION_TOOLS.map((tool) => `- **${tool.name}** — ${tool.summary}`),
  ].join('\n');

  const texts = new Map(SECTION_TOOLS.map((tool) => [tool.name, tool.titles.map(section).join('\n\n')]));
  return {
    system: preamble + [...CORE_TITLES.map(section), directory].join('\n\n'),
    tools: SECTION_TOOLS.map((tool) => ({
      name: tool.name,
      description: `Load the reference section: ${tool.summary.toLowerCase()}.`,
      parameters: NO_PARAMETERS,
    })),
    resolveTool: (call) => texts.get(call.name),
  };
}

/** A registry section's entries by name, and the text before the first of them. */
interface Entries {
  intro: string;
  entries: Map<string, string>;
}

/** Component entries start `- name (Kind)`, `- name — description` or a bare `- name`. */
const COMPONENT_ENTRY = /^- ([A-Za-z][\w-]*)(?: \(| —|$)/;
/** Store entries start `SpaceStore:`, and are asked for as `spaceStore`. */
const STORE_ENTRY = /^([A-Z]\w*):$/;

function parseEntries(text: string, start: RegExp, key: (match: RegExpMatchArray) => string): Entries {
  const intro: string[] = [];
  const entries = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of text.split('\n')) {
    const match = line.match(start);
    if (match) {
      current = [line];
      entries.set(key(match), current);
    } else if (/^@we\/[\w-]+:$/.test(line)) {
      // A package heading between groups of components belongs to no entry.
      current = null;
    } else if (current) {
      current.push(line);
    } else {
      intro.push(line);
    }
  }
  return {
    intro: intro.join('\n').trim(),
    entries: new Map([...entries].map(([name, lines]) => [name, lines.join('\n').trimEnd()])),
  };
}

const LOOKUP_CORE_TITLES = [
  ...CORE_TITLES,
  'Prop-level Dynamic Logic & Expressions',
  'Block-level Dynamic Structures',
  'Design System Props',
];

const LOOKUP_SECTIONS: Record<string, string> = {
  patterns: 'Common Patterns (copy these shapes)',
  plugins: 'Component Plugin Registries',
  panels: 'Panels',
  storePatterns: 'Store Usage Patterns',
  modules: 'Feature Modules',
};

/**
 * Words in a request that mean a component. A request says "button", not "we-button", so matching
 * tag names alone would preselect almost nothing a person asks for in their own words.
 */
const COMPONENT_WORDS: Record<string, string[]> = {
  button: ['we-button'],
  input: ['we-input'],
  field: ['we-form-field', 'we-input'],
  form: ['we-form-field', 'we-input'],
  search: ['Search', 'we-input'],
  text: ['we-text'],
  heading: ['we-text'],
  title: ['we-text'],
  icon: ['we-icon'],
  image: ['we-image'],
  avatar: ['we-avatar', 'AvatarStack'],
  badge: ['we-badge'],
  tag: ['we-tag'],
  tab: ['we-tabs', 'we-tab'],
  tabs: ['we-tabs', 'we-tab'],
  modal: ['we-modal'],
  dialog: ['we-modal'],
  select: ['we-select'],
  dropdown: ['DropdownMenu', 'we-select'],
  switch: ['we-switch'],
  toggle: ['we-switch'],
  checkbox: ['we-checkbox'],
  grid: ['Grid'],
  card: ['Card'],
  row: ['Row'],
  column: ['Column'],
  list: ['Column'],
  graph: ['GraphView'],
  map: ['GraphView'],
  calendar: ['Calendar'],
  divider: ['we-divider'],
  tooltip: ['we-tooltip'],
  spinner: ['we-spinner'],
  progress: ['we-progress-bar'],
  markdown: ['we-markdown'],
  link: ['we-link'],
  date: ['we-date-picker'],
  timestamp: ['we-timestamp'],
  number: ['we-number'],
  slider: ['we-slider'],
  alert: ['we-alert'],
  skeleton: ['we-skeleton'],
};

/** Tags a template already uses — the components a change to it is most likely to touch. */
function componentsIn(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const child of node) componentsIn(child, found);
  } else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (typeof record.type === 'string' && !record.type.startsWith('$')) found.add(record.type);
    for (const value of Object.values(record)) componentsIn(value, found);
  }
  return found;
}

/** Stores named anywhere in the template or the request, as `spaceStore`. */
function storesIn(...texts: string[]): Set<string> {
  const found = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(/\b([a-z]\w*Store)\b/g)) found.add(match[1]);
  return found;
}

export function lookupContext(
  preamble: string,
  reference: string,
  subject: { request: string; schema: SchemaNode },
): PreparedContext {
  const section = sectionsByTitle(reference);
  const components = parseEntries(section('Component Registry'), COMPONENT_ENTRY, (m) => m[1]);
  const stores = parseEntries(section('Stores'), STORE_ENTRY, (m) => m[1][0].toLowerCase() + m[1].slice(1));

  const words = subject.request.toLowerCase().match(/[a-z]+/g) ?? [];
  const wanted = new Set([...componentsIn(subject.schema), ...words.flatMap((word) => COMPONENT_WORDS[word] ?? [])]);
  const schemaText = JSON.stringify(subject.schema);
  const wantedStores = storesIn(schemaText, subject.request);

  const pick = (from: Entries, names: Set<string>) =>
    [...names].map((name) => from.entries.get(name)).filter((entry): entry is string => !!entry);

  const preselected = [
    '## Selected Reference',
    '',
    'Entries picked for this request from the template it edits and the words it uses. Anything else',
    'is one `we_reference` call away — look up a component, store or section before using it rather',
    'than guessing its props or members.',
    '',
    components.intro,
    ...pick(components, wanted),
    '',
    stores.intro,
    ...pick(stores, wantedStores),
    '',
    '### Everything that can be looked up',
    '',
    `Components: ${[...components.entries.keys()].join(', ')}`,
    `Stores: ${[...stores.entries.keys()].join(', ')}`,
    `Sections: ${Object.keys(LOOKUP_SECTIONS).join(', ')}`,
  ].join('\n');

  const describe = (kind: string, from: Entries, names: unknown): string[] =>
    (Array.isArray(names) ? names : []).map(String).map((name) => {
      const entry = from.entries.get(name);
      if (entry) return entry;
      const near = [...from.entries.keys()].filter((known) => known.toLowerCase().includes(name.toLowerCase()));
      return `No ${kind} named "${name}".${near.length ? ` Did you mean: ${near.slice(0, 5).join(', ')}?` : ''}`;
    });

  return {
    system: preamble + [...LOOKUP_CORE_TITLES.map(section), preselected].join('\n\n'),
    tools: [
      {
        name: 'we_reference',
        description:
          'Look up reference entries by name: components (props, slots, descriptions), stores (state and actions) and whole sections. Ask for several at once.',
        parameters: {
          type: 'object',
          properties: {
            components: { type: 'array', items: { type: 'string' }, description: 'Tags, e.g. "we-button", "Grid".' },
            stores: { type: 'array', items: { type: 'string' }, description: 'Store names, e.g. "spaceStore".' },
            sections: { type: 'array', items: { type: 'string', enum: Object.keys(LOOKUP_SECTIONS) } },
          },
        },
      },
    ],
    resolveTool: (call) => {
      if (call.name !== 'we_reference') return undefined;
      const args = call.arguments as { components?: unknown; stores?: unknown; sections?: unknown };
      const found = [
        ...describe('component', components, args.components),
        ...describe('store', stores, args.stores),
        ...(Array.isArray(args.sections) ? args.sections : []).map(String).map((name) => {
          const title = LOOKUP_SECTIONS[name];
          return title
            ? section(title)
            : `No section named "${name}". Sections: ${Object.keys(LOOKUP_SECTIONS).join(', ')}`;
        }),
      ];
      return found.length ? found.join('\n\n') : 'Nothing was asked for. Pass components, stores or sections.';
    },
  };
}

export function prepareContext(
  strategy: ContextStrategyId,
  preamble: string,
  reference: string,
  subject: { request: string; schema: SchemaNode },
): PreparedContext {
  switch (strategy) {
    case 'sections':
      return sectionsContext(preamble, reference);
    case 'lookup':
      return lookupContext(preamble, reference, subject);
    default:
      return fullContext(preamble, reference);
  }
}
