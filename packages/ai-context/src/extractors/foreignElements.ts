/**
 * The custom elements a deployment's seed allows, read from each package's custom-elements manifest.
 *
 * ## What it is for
 *
 * A seed's `elements` says "these tags are defined in this build, trust them". This turns that into
 * what the rest of the pipeline needs: names the validator accepts instead of calling unknown, and a
 * reference entry — props, events, description — so a person or a model can write the node correctly
 * without opening the library's docs.
 *
 * ## The manifest is the library's own
 *
 * Custom-elements manifests are the convention a package points at through the `customElements`
 * field of its `package.json`; Shoelace, Web Awesome, Spectrum and most modern element libraries ship
 * one. Read here in the schema the convention defines (`modules[].declarations[]` with
 * `customElement: true`), not WE's own extension of it, so any conforming package works.
 *
 * `foreignElementsFromManifest` is the pure half, and what the tests exercise with a fixture.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ForeignElementEntry, PropEntry } from '../types.js';

/** One seed entry, as `we-seed.json` spells it. */
export interface SeedElements {
  package: string;
  define?: string[];
  tags?: string[];
  manifest?: string;
}

interface CemType {
  text?: string;
}

interface CemMember {
  kind?: string;
  name?: string;
  type?: CemType;
  default?: string;
  privacy?: string;
  static?: boolean;
  readonly?: boolean;
  description?: string;
}

interface CemAttribute {
  name?: string;
  fieldName?: string;
  type?: CemType;
  default?: string;
}

interface CemDeclaration {
  kind?: string;
  customElement?: boolean;
  tagName?: string;
  description?: string;
  summary?: string;
  members?: CemMember[];
  attributes?: CemAttribute[];
  events?: { name?: string }[];
}

export interface CustomElementsManifest {
  modules?: { declarations?: CemDeclaration[] }[];
}

/**
 * The elements a manifest declares, as reference entries — limited to `tags` when given.
 *
 * Props are the public, writable instance fields, since the renderer sets props as properties; an
 * attribute with no field is included under its attribute name, which is what an element whose
 * manifest lists only attributes reads.
 */
export function foreignElementsFromManifest(
  manifest: CustomElementsManifest,
  pkg: string,
  tags?: readonly string[],
): ForeignElementEntry[] {
  const allowed = tags ? new Set(tags) : undefined;
  const out: ForeignElementEntry[] = [];
  for (const mod of manifest.modules ?? []) {
    for (const declaration of mod.declarations ?? []) {
      if (!declaration.customElement || !declaration.tagName) continue;
      if (allowed && !allowed.has(declaration.tagName)) continue;

      const props = new Map<string, PropEntry>();
      for (const member of declaration.members ?? []) {
        if (member.kind !== 'field' || !member.name || member.static || member.readonly) continue;
        if (member.privacy && member.privacy !== 'public') continue;
        if (member.name.startsWith('_')) continue;
        props.set(member.name, {
          name: member.name,
          type: member.type?.text ?? 'unknown',
          optional: true,
          ...(member.default !== undefined ? { default: member.default } : {}),
        });
      }
      for (const attribute of declaration.attributes ?? []) {
        const name = attribute.fieldName ?? attribute.name;
        if (!name || props.has(name)) continue;
        props.set(name, {
          name,
          type: attribute.type?.text ?? 'string',
          optional: true,
          ...(attribute.default !== undefined ? { default: attribute.default } : {}),
        });
      }

      const description = declaration.summary ?? declaration.description;
      out.push({
        tagName: declaration.tagName,
        package: pkg,
        ...(description ? { description } : {}),
        props: [...props.values()],
        events: [...new Set((declaration.events ?? []).map((e) => e.name).filter((n): n is string => Boolean(n)))],
      });
    }
  }
  return out;
}

/**
 * Every element the seed allows, read from the packages installed for `@we/app-shell` — the
 * dependency set the build resolves them from.
 *
 * A tag the seed lists that its package's manifest does not declare is still allowed, with no props:
 * the seed is the trust decision and the manifest is only documentation, so a library without one
 * works and is merely undocumented.
 */
export function extractForeignElements(repoRoot: string): ForeignElementEntry[] {
  const seed = JSON.parse(readFileSync(resolve(repoRoot, 'we-seed.json'), 'utf-8')) as { elements?: SeedElements[] };
  const nodeModules = resolve(repoRoot, 'packages/app-shell/node_modules');
  const out: ForeignElementEntry[] = [];

  for (const entry of seed.elements ?? []) {
    const dir = resolve(nodeModules, entry.package);
    if (!existsSync(dir)) {
      console.warn(`  Warning: seed element package "${entry.package}" is not installed for @we/app-shell`);
      continue;
    }
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf-8')) as { customElements?: string };
    const manifestPath = entry.manifest ?? pkg.customElements;
    const manifest: CustomElementsManifest =
      manifestPath && existsSync(resolve(dir, manifestPath))
        ? JSON.parse(readFileSync(resolve(dir, manifestPath), 'utf-8'))
        : {};
    const found = foreignElementsFromManifest(manifest, entry.package, entry.tags);
    const documented = new Set(found.map((element) => element.tagName));
    for (const tag of entry.tags ?? []) {
      if (!documented.has(tag)) found.push({ tagName: tag, package: entry.package, props: [], events: [] });
    }
    console.log(`  Foreign elements: ${entry.package} — ${found.map((e) => e.tagName).join(', ') || '(none)'}`);
    out.push(...found);
  }
  return out;
}
