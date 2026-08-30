/**
 * Extract, from the app shell's source, the two lists that decide what a schema may *name*:
 * store members and host-registered components.
 *
 * ## Why these are derived rather than written down
 *
 * Both were hand-maintained, and both drifted — silently, because the thing that would have caught
 * the drift was itself broken. `shellComponents` was missing `CesiumGlobe` and `TemplateCard`, so
 * every schema using them failed as an unknown component; `storeEntries` was missing five members
 * that had existed for months, so correct templates were reported as wrong. Nobody noticed either,
 * because the routes containing them were not being validated at all (see the typeless-node fix in
 * `semanticValidation.ts`).
 *
 * A list you must remember to update is a list that will be wrong. Names are mechanically derivable
 * from the interfaces and the registry, so they are derived here and cannot drift again.
 *
 * ## What stays hand-authored, and why
 *
 * **Prose and shape metadata.** A member's *description* is judgement, and `StateMemberMeta`'s
 * `properties`/`model` is what lets the validator check `{ $: 'spaceStore.currentSpace.name' }` one
 * level deeper — neither is recoverable from `Accessor<Space | null>` without resolving the type.
 *
 * So the split is: **source owns the names, the fragment owns the meaning.** `generate.ts` joins
 * them and reports both directions of drift — a member with no description, and a description for a
 * member that no longer exists.
 */
import { type ObjectLiteralExpression, Project, SyntaxKind } from 'ts-morph';

import type { SourceEntry, StateMemberMeta } from '../types.js';

export interface ExtractedStore {
  /** As a template names it — `SpaceStore` → `spaceStore`. */
  name: string;
  /** Derived coarse metadata per state member; `properties`/`model` are the fragment's to add. */
  state: Record<string, StateMemberMeta>;
  actions: string[];
}

/**
 * `Accessor<Foo[]>` → `array`, and so on down to `object`.
 *
 * Coarse on purpose. This exists so a newly added member is *allowed* rather than reported as
 * unknown; narrowing it further would need the type resolved, which is what `properties` in the
 * fragment is for. An over-broad type here costs nothing — the deeper check only runs when the
 * fragment supplies `properties`.
 */
function coarseType(typeText: string): StateMemberMeta['type'] {
  const inner = /^Accessor<([\s\S]*)>$/.exec(typeText.trim())?.[1]?.trim() ?? typeText.trim();
  if (/\[\]$/.test(inner) || /^(readonly\s+)?Array</.test(inner)) return 'array';
  // Union members are stripped before testing, so `string | null` still reads as a string.
  const bare = inner
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s !== 'null' && s !== 'undefined');
  if (bare.every((s) => s === 'string')) return 'string';
  if (bare.every((s) => s === 'boolean')) return 'boolean';
  if (bare.every((s) => s === 'number')) return 'number';
  return 'object';
}

/**
 * Actions are members a template *calls*; state is what it reads.
 *
 * Callability alone does not separate them, because the stores expose state two ways: most use
 * `Accessor<T>`, but several write the same thing as a bare `() => T` — `datasetStore.globalSpaceId`
 * is state, spelled as a nullary arrow. Reading callability alone filed it under actions while the
 * fragment documented it as state, so it was reported as simultaneously missing and undocumented.
 *
 * The rule: **a nullary function returning a value is an accessor; anything else is an action.**
 * Taking arguments means doing something with them, and returning nothing means the point was the
 * effect. It misfiles the rare nullary command that also returns a value, which costs nothing that
 * matters — the validator merges state and actions into one set of legal names, and the only thing
 * riding on the split is whether coarse type metadata is attached.
 */
function isAction(typeText: string): boolean {
  const t = typeText.trim();
  // `Accessor<...>` is a call signature in name only — it is how state is exposed.
  if (t.startsWith('Accessor<')) return false;

  const fn = /^\(([\s\S]*?)\)\s*=>\s*([\s\S]+)$/.exec(t);
  if (!fn) return t.startsWith('<'); // a generic method signature
  const [, params, returns] = fn;
  if (params.trim()) return true;
  const r = returns.trim();
  // No accessor answers with a promise: `saveEditingTheme: () => Promise<ThemeData | null>` is a
  // command that happens to return what it saved, and filing it as state described it as a value.
  if (r.startsWith('Promise<')) return true;
  return r === 'void' || r === 'unknown';
}

/**
 * The functions the host lends to expressions — `hostSources` in `shared/sources/index.ts`.
 *
 * Read from the registry rather than declared again here, for the reason the plugin catalogues
 * are: a name the generated context does not carry is one an author has to already know, and a
 * second list would drift from the first.
 */
export function extractHostSources(registryFile: string): SourceEntry[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const file = project.addSourceFileAtPath(registryFile);

  const decl = file.getVariableDeclaration('hostSources');
  const list = decl?.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression);
  if (!list) throw new Error(`could not read hostSources from ${registryFile}`);

  const text = (literal: ObjectLiteralExpression, name: string): string => {
    const initializer = literal.getProperty(name);
    if (!initializer || !initializer.isKind(SyntaxKind.PropertyAssignment)) return '';
    const value = initializer.getInitializer();
    if (value?.isKind(SyntaxKind.StringLiteral) || value?.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
      return value.getLiteralText();
    }
    return '';
  };

  const entries: SourceEntry[] = [];
  for (const element of list.getElements()) {
    if (!element.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
    const params = element.getProperty('params');
    const paramList = params?.isKind(SyntaxKind.PropertyAssignment)
      ? (params
          .getInitializerIfKind(SyntaxKind.ArrayLiteralExpression)
          ?.getElements()
          .map((p) => (p.isKind(SyntaxKind.StringLiteral) ? p.getLiteralText() : ''))
          .filter(Boolean) ?? [])
      : [];
    entries.push({
      name: text(element, 'name'),
      params: paramList,
      doc: text(element, 'doc'),
      example: text(element, 'example'),
    });
  }
  return entries.filter((entry) => entry.name);
}

/**
 * Members `templateSurface.ts` classifies as host wiring, per store.
 *
 * Wiring is never in any bag at any tier, so a schema cannot reach it — and a reference that names
 * something no schema can reach is the one kind the generated context must not carry. Every such
 * member used to be listed as `unknown`, which reads as a capability nobody has described rather
 * than as a capability that does not exist for a template. Read from the classification rather than
 * kept as a second list, so a member reclassified there disappears from here on the next run.
 */
export function extractWiringMembers(surfaceFile: string): Map<string, Set<string>> {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const file = project.addSourceFileAtPath(surfaceFile);

  const decl = file.getVariableDeclaration('TEMPLATE_SURFACE');
  const surface = decl?.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
  if (!surface) throw new Error(`could not read TEMPLATE_SURFACE from ${surfaceFile}`);

  const wiring = new Map<string, Set<string>>();
  for (const storeProp of surface.getProperties()) {
    if (!storeProp.isKind(SyntaxKind.PropertyAssignment)) continue;
    const members = storeProp.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
    if (!members) continue;
    const names = new Set<string>();
    for (const member of members.getProperties()) {
      if (!member.isKind(SyntaxKind.PropertyAssignment)) continue;
      if (member.getInitializer()?.getText() === 'WIRING') names.add(member.getName());
    }
    if (names.size) wiring.set(storeProp.getName(), names);
  }
  return wiring;
}

/**
 * Store interfaces, read from the app shell.
 *
 * Keyed on the `export interface *Store` declarations rather than on the provider functions: the
 * interface is the contract a template is written against, and it is one declaration per store with
 * no conditional assembly to interpret.
 */
export function extractStores(storesDir: string): ExtractedStore[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(`${storesDir}/*.tsx`);

  const stores: ExtractedStore[] = [];

  for (const file of project.getSourceFiles()) {
    for (const iface of file.getInterfaces()) {
      const name = iface.getName();
      if (!iface.isExported() || !/Store$/.test(name)) continue;

      const state: Record<string, StateMemberMeta> = {};
      const actions: string[] = [];

      for (const prop of iface.getProperties()) {
        const typeText = prop.getTypeNode()?.getText() ?? '';
        if (isAction(typeText)) actions.push(prop.getName());
        else state[prop.getName()] = { type: coarseType(typeText) };
      }
      // `foo(): T` rather than `foo: () => T` — the same thing said the other way, and several
      // stores mix the two spellings.
      for (const method of iface.getMethods()) actions.push(method.getName());

      stores.push({ name: name.charAt(0).toLowerCase() + name.slice(1), state, actions });
    }
  }

  return stores.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every key of the host's component registry.
 *
 * The registry is the single source for what a template may name — its own comment says so — so
 * reading its keys is the whole job. `generate.ts` subtracts the components already documented from
 * the design-system packages; whatever is left is the shell/internal set that would otherwise be
 * reported as unknown.
 */
export function extractRegisteredComponents(registryFile: string): string[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const file = project.addSourceFileAtPath(registryFile);

  const decl = file.getVariableDeclaration('componentRegistry');
  const literal = decl?.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
  if (!literal) return [];

  const names: string[] = [];
  for (const prop of literal.getProperties()) {
    // `CesiumGlobe: CesiumGlobeOnDemand` and the shorthand `AiPanel` are both ordinary entries; a
    // spread would not be, and is deliberately not followed — it would be a second source.
    if (prop.isKind(SyntaxKind.PropertyAssignment)) names.push(prop.getName().replace(/^['"]|['"]$/g, ''));
    else if (prop.isKind(SyntaxKind.ShorthandPropertyAssignment)) names.push(prop.getName());
  }
  return names.sort();
}
