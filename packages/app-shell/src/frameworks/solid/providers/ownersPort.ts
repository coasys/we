/**
 * What the editor is told about the regions of a page somebody else provides.
 *
 * The editor names an owner and offers the routes to taking a region over; which modules exist,
 * which are on here, what a part is called and what it needs are this host's to say. Built from the
 * module registry and the stores, and nothing else — so the editor can stay ignorant of both.
 */
import type { OwnedPart, OwnersPort } from '@we/editor/runtime';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';

import { describeMissing, fixFor, whyMissing } from '../../../shared/partAvailability';
import { openPart, openPartPath } from '../../../shared/registries/moduleParts';
import { moduleRegistry, type RegisteredPart } from '../../../shared/registries/moduleRegistry';
import { viewRegistry } from '../../../shared/registries/viewRegistry';
import type { DatasetStore } from '../stores/DatasetStore';
import type { ShellStore } from '../stores/ShellStore';
import type { SpaceStore } from '../stores/SpaceStore';
import type { TemplateStore } from '../stores/TemplateStore';

/** Template data is JSON; copied that way because a store hands over proxies `structuredClone` refuses. */
const copyOf = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const humanise = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/**
 * The parts a tree places, by id, in order and once each — the pieces "arrange its pieces" keeps the
 * module's. Read off the tree rather than inferred, so a panel that pasted a piece in rather than
 * placing it is not credited with keeping it.
 */
function partsPlaced(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((entry) => partsPlaced(entry, out));
  else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    const id = record.type === '$part' ? (record.props as { id?: unknown } | undefined)?.id : undefined;
    if (typeof id === 'string') {
      if (!out.includes(id)) out.push(id);
    } else Object.values(record).forEach((entry) => partsPlaced(entry, out));
  }
  return out;
}

export function createOwnersPort(deps: {
  space: SpaceStore;
  shell: ShellStore;
  dataset: DatasetStore;
  template: TemplateStore;
}): OwnersPort {
  const { space, shell, dataset, template } = deps;

  const describe = (id: string, part?: RegisteredPart): OwnedPart => {
    const moduleId = id.split('.')[0] ?? '';
    const moduleName = moduleRegistry.get(moduleId)?.definition.manifest.name ?? humanise(moduleId);
    const why = whyMissing({
      registered: !!moduleRegistry.get(moduleId),
      published: !!part,
      inSpace: !!dataset.currentDataset(),
      active: space.activeModules().includes(moduleId),
      installed: space.installedModules().includes(moduleId),
      enabled: space.enabledModules().includes(moduleId),
    });
    const canAdminister = space.canAdministerCurrentSpace();
    const fix = why
      ? fixFor(why, {
          canAdminister,
          datasetId: dataset.currentDataset()?.id,
          openShellView: shell.openShellView,
          openSpaceSettings: shell.openSpaceSettings,
        })
      : null;
    return {
      id,
      label: part?.label ?? humanise(id.split('.')[1] ?? id),
      description: part?.description,
      moduleId,
      moduleName,
      inputs: Object.entries(part?.inputs ?? {}).map(([name, input]) => ({ name, description: input.description })),
      missing: why ? describeMissing(why, { moduleName, canAdminister }) : '',
      ...(fix ? { fix } : {}),
    };
  };

  const panelOf = (dockId: string) => {
    const [moduleId, dock] = dockId.split(':');
    const registered = moduleRegistry.get(moduleId ?? '');
    const panel = registered?.definition.contributes?.panels?.find((p) => p.name === dock);
    return registered && panel ? { registered, panel, moduleId: moduleId!, dock: dock! } : null;
  };

  return {
    part: (id) => describe(id, moduleRegistry.parts()[id]),

    parts: () =>
      Object.values(moduleRegistry.parts())
        .map((part) => describe(part.id, part))
        // Only what can be placed and seen here: a palette offering a piece that draws a placeholder
        // the moment it lands would be offering the problem rather than the part.
        .filter((part) => !part.missing)
        .sort((a, b) => a.moduleName.localeCompare(b.moduleName) || a.label.localeCompare(b.label)),

    openPart: (placement, depth) => openPart(placement, depth),

    openPath: (placement, chain, target) => openPartPath(placement, chain, target),

    panel: (dockId) => {
      const found = panelOf(dockId);
      if (!found) return null;
      return {
        dockId,
        moduleId: found.moduleId,
        moduleName: found.registered.definition.manifest.name,
        dock: found.dock,
        title: found.panel.title ?? humanise(found.dock),
        composed: partsPlaced(found.panel.node).length > 0,
        placed: partsPlaced(found.panel.node).map((id) => describe(id, moduleRegistry.parts()[id]).label),
      };
    },

    panelNode: (dockId) => {
      const node = panelOf(dockId)?.panel.node;
      return node ? (copyOf(node) as SchemaNode) : null;
    },

    view: (id) => {
      const resolved = space.routableViews().find((view) => view.id === id);
      if (!resolved) return null;
      const owner = moduleRegistry.viewOwners()[id];
      const source =
        id in viewRegistry
          ? 'built into WE'
          : owner
            ? `from ${moduleRegistry.get(owner)?.definition.manifest.name ?? humanise(owner)}`
            : template.spaceTemplates().some((t) => t.id === id)
              ? 'this space’s own'
              : 'one of your own';
      const forkBlocked = !dataset.currentDataset()
        ? 'Open a space to change its sections.'
        : !space.canAdministerCurrentSpace()
          ? 'Only whoever runs this space can replace its sections.'
          : '';
      return { id, name: resolved.schema.meta?.name ?? humanise(id), source, forkBlocked };
    },

    /*
      Saved into the space rather than the person's library, because a section is part of what the
      space is: a copy only one member could see would leave two people reading one address and
      getting different pages. Swapped in where the original was, in one write of the section list.
    */
    forkView: async (id) => {
      const resolved = space.routableViews().find((view) => view.id === id);
      if (!resolved || !space.canAdministerCurrentSpace()) return null;
      const before = new Set(template.spaceTemplates().map((t) => t.id));
      const copy = copyOf(resolved.schema) as TemplateSchema;
      copy.forkedFrom = id;
      // Saved without becoming the template on screen: the copy takes the section's place in the
      // shell, and making it current would replace the whole shell with one section.
      if (!(await template.saveTemplateAs(copy, 'space', { activate: false }))) return null;
      const made = template.spaceTemplates().find((t) => !before.has(t.id) && t.forkedFrom === id);
      if (!made?.id) return null;
      const order = space.enabledViewIds();
      await space.setViewEnabled(made.id, true);
      await space.reorderViews(order.includes(id) ? order.map((v) => (v === id ? made.id! : v)) : [...order, made.id]);
      return made.id;
    },

    openTemplate: (id) => {
      const fromSpace = template.spaceTemplates().some((t) => t.id === id);
      template.switchTemplate(fromSpace ? `space::${id}` : id);
    },
  };
}
