/**
 * What the editor is told about the regions of a page somebody else provides.
 *
 * The editor names an owner and offers the routes to taking a region over; which modules exist,
 * which are on here, what a part is called and what it needs are this host's to say. Built from the
 * module registry and the stores, and nothing else — so the editor can stay ignorant of both.
 */
import type { OwnedPart, OwnersPort } from '@we/editor/runtime';
import type { SchemaNode } from '@we/schema-shared';

import { describeMissing, fixFor, whyMissing } from '../../../shared/partAvailability';
import { openPart } from '../../../shared/registries/moduleParts';
import { moduleRegistry, type RegisteredPart } from '../../../shared/registries/moduleRegistry';
import { viewRegistry } from '../../../shared/registries/viewRegistry';
import type { DatasetStore } from '../stores/DatasetStore';
import type { ShellStore } from '../stores/ShellStore';
import type { SpaceStore } from '../stores/SpaceStore';
import type { TemplateStore } from '../stores/TemplateStore';

const humanise = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** Whether a tree places any part — what makes "arrange its pieces" keep the pieces the module's. */
const placesParts = (node: unknown): boolean => JSON.stringify(node ?? null).includes('"$part"');

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

    panel: (dockId) => {
      const found = panelOf(dockId);
      if (!found) return null;
      return {
        dockId,
        moduleId: found.moduleId,
        moduleName: found.registered.definition.manifest.name,
        dock: found.dock,
        title: found.panel.title ?? humanise(found.dock),
        composed: placesParts(found.panel.node),
      };
    },

    panelNode: (dockId) => {
      const node = panelOf(dockId)?.panel.node;
      return node ? (structuredClone(node) as SchemaNode) : null;
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
      return { id, name: resolved.schema.meta?.name ?? humanise(id), source };
    },
  };
}
