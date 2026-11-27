import { isExpressionToken, parseExpression, referencedPaths } from '@we/expressions';

import { PROFILE_NAMESPACES } from './lookup';

/**
 * The profiles and modules a template names, each with the first name that reached it — what
 * `meta.requires` is checked against.
 *
 * A profile is named by writing a member under its namespace (`viewState.openPanel` names
 * `view-state`). A module is named by its store (`modules.call.inCall`), a part of its
 * (`{ type: '$part', props: { id: 'call.controls' } }`) or a panel placing it (`meta.panels` with
 * `module`). The walk reads the same places the host-only report does: expressions, `$invoke` and a
 * query's dataset.
 */
export interface NamedCatalogs {
  /** By profile id, the first member named under its namespace. */
  profiles: Map<string, string>;
  /** By module id, the first name that reached it. */
  modules: Map<string, string>;
}

export function catalogsNamedBy(schema: unknown): NamedCatalogs {
  const profiles = new Map<string, string>();
  const modules = new Map<string, string>();
  const note = (path: string) => {
    const [root, first] = path.split('.');
    if (!root || !first) return;
    if (root === 'modules') {
      if (!modules.has(first)) modules.set(first, path);
      return;
    }
    const profile = PROFILE_NAMESPACES.get(root);
    if (profile && !profiles.has(profile.id)) profiles.set(profile.id, `${root}.${first}`);
  };

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (typeof node.$invoke === 'string') note(node.$invoke);
    if (isExpressionToken(node)) {
      try {
        for (const { root, path } of referencedPaths(parseExpression(node.$))) {
          if (path.length > 0) note([root, ...path].join('.'));
        }
      } catch {
        // A syntax error is reported by the expression check.
      }
    }
    if (typeof node.entity === 'string' && typeof node.dataset === 'string') note(node.dataset);
    if (node.type === '$part') {
      const id = (node.props as { id?: unknown } | undefined)?.id;
      // A host part (`host.sidebar`) is the host's own, never a module's.
      if (typeof id === 'string' && id.includes('.') && !id.startsWith('host.')) {
        const module = id.slice(0, id.indexOf('.'));
        if (!modules.has(module)) modules.set(module, `$part ${id}`);
      }
    }
    for (const entry of Object.values(node)) walk(entry);
  };
  walk(schema);

  const panels = (schema as { meta?: { panels?: unknown } } | null)?.meta?.panels;
  if (Array.isArray(panels))
    for (const panel of panels) {
      const module = (panel as { module?: unknown } | null)?.module;
      // `shell` is the host's own panel (the space's settings), named as a module is but not one.
      if (typeof module === 'string' && module !== 'shell' && !modules.has(module))
        modules.set(module, `the panel ${module}`);
    }

  return { profiles, modules };
}
