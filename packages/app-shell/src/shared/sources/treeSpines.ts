/**
 * The choices a tree's spine picker offers: the space's named connection kinds, plus every relation
 * the installed models declare — the second list being the whole point of following a tree built
 * out of the data rather than out of `Relationship` records.
 *
 * ## Why a host function
 *
 * The two halves come from different places — kinds are records a `$query` subscribes to, model
 * relations are a manifest — and an expression cannot concatenate two lists. Merging them here also
 * lets the value encoding live in one place: `rel:` prefixed so the layout's `spine` selector and
 * `arrangeOnTree` both read which kind of claim was picked off the same string, and a bare id stays
 * a connection kind, exactly as an address bar saved before this existed spells it.
 *
 * ## What it decides
 *
 * - **Only typed relations.** A relation naming no target class (`CollectionBlock.children`,
 *   `Relationship.source`) could join anything to anything — not a spine, and the canvas seed
 *   already refuses to follow it.
 * - **The models are the merged manifest** — core entities, then the space's own shapes, then the
 *   foreign schemas it installed — the same precedence the graph's `models` answers, so a shape that
 *   shadows a core name picks the same relation the canvas follows.
 * - **"All model relations" is one choice**, spelled `rel:*`. It filters the tree to edges typed
 *   `relation` — the claims the models hold — where the empty choice ("Any connection") follows
 *   every line there is, relations and connections alike.
 */
import { type EntityManifestEntry, manifestEntries } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';

/** A shape record as `shapeStore.spaceShapes` hands one over — only the fields this reads. */
interface ShapeInput {
  name: string;
  manifest?: { entities: Record<string, unknown> } | null;
  problems?: unknown[];
}

interface KindInput {
  id?: string;
  name?: string;
  icon?: string;
}

export interface SpineOption {
  label: string;
  value: string;
  icon?: string;
  group?: string;
}

/**
 * Every entity this dataset means by its models — the same three-source merge `GraphHost` performs
 * for `models`, so the relations offered are the relations the canvas actually follows.
 */
export function modelManifestEntries(options: {
  shapes?: readonly ShapeInput[];
  foreign?: readonly EntityManifestEntry[];
}): EntityManifestEntry[] {
  const core = manifestEntries(CORE_MANIFEST);
  const known = new Set(core.map((entry) => entry.name));
  const entries: EntityManifestEntry[] = [...core];
  for (const shape of options.shapes ?? []) {
    if (!shape.manifest || shape.problems?.length || known.has(shape.name)) continue;
    for (const entry of manifestEntries(shape.manifest as never, { parents: CORE_MANIFEST })) {
      if (known.has(entry.name)) continue;
      known.add(entry.name);
      entries.push(entry);
    }
  }
  for (const entry of options.foreign ?? []) {
    if (known.has(entry.name)) continue;
    known.add(entry.name);
    entries.push(entry);
  }
  return entries;
}

export function treeSpines(options: {
  kinds?: readonly KindInput[];
  shapes?: readonly ShapeInput[];
  foreign?: readonly EntityManifestEntry[];
}): SpineOption[] {
  const relations: SpineOption[] = [];
  for (const entry of modelManifestEntries(options)) {
    for (const property of entry.properties) {
      if (property.type !== 'uri' || !property.relatedEntity) continue;
      relations.push({
        label: `${entry.name} › ${property.name}`,
        value: `rel:${entry.name}.${property.name}`,
        icon: 'link',
        group: 'Model relations',
      });
    }
  }
  return [
    ...(options.kinds ?? [])
      .filter((kind) => typeof kind.id === 'string' && kind.id)
      .map((kind) => ({ label: kind.name ?? kind.id!, value: kind.id!, icon: kind.icon })),
    ...(relations.length
      ? [
          { label: 'All model relations', value: 'rel:*', icon: 'tree-structure', group: 'Model relations' },
          ...relations,
        ]
      : []),
  ];
}
