import { gatePrompt } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

export interface MarketplaceListOptions {
  /** What to list out of the marketplace dataset — `Template` or `Theme`. */
  entity: string;
  /** Context key for one row. Also names the hoisted results (`<as>Items`). */
  as: string;
  /** Plural noun, for the search placeholder and the empty state. */
  label: string;
  /** The empty state's icon — the type's own. */
  emptyIcon: string;
  /** A second line under the empty state's title. The compact form omits it. */
  emptyBody?: string;
  /** Props for each row's `TemplateCard` beyond `template`, which is supplied. */
  card: Record<string, SchemaProp>;
  /**
   * Three across, for the marketplace's own pages, or a single column for a panel inside settings.
   * The difference is the surface, not the content — the same rows either way.
   */
  layout?: 'grid' | 'list';
  /** Offer a newest/oldest control, and drive the query's order from it. */
  sortable?: boolean;
  /** Relations to hydrate — screenshots, on the pages that show them. */
  include?: Record<string, unknown>;
}

/**
 * Browse what the marketplace holds, with a search box and a card per item.
 *
 * There were four of these and they were two pairs of near-identical files: templates and themes
 * on the marketplace's own pages, and the same two again as compact panels inside space settings.
 * Copies rather than choices, and they had already drifted — the themes page wires up install,
 * delete and a per-row spinner, and the templates page beside it wires up none of the three.
 *
 * The four axes that genuinely differ are options here; everything else is the same list. Reading
 * `datasetStore.marketplaceDataset` puts this in the WE tier: a deployment without a marketplace
 * gets a query against nothing.
 */
export function marketplaceList(opts: MarketplaceListOptions): SchemaNode {
  const key = `${opts.as}Items`;
  const grid = opts.layout !== 'list';

  /** What the grid actually shows — the filter the count below must agree with. */
  const matching = { $filter: { items: { $local: key }, where: { name: { contains: { $local: 'search' } } } } };

  const rows: SchemaNode = {
    type: '$each',
    props: { items: matching, as: opts.as },
    children: [{ type: 'TemplateCard', props: { template: `$${opts.as}`, ...opts.card } }],
  };

  return {
    type: 'Column',
    props: grid ? { flex: '1', p: '500', gap: '400', ax: 'center', minHeight: '100%' } : { gap: '300' },
    $localState: {
      search: { type: 'string', initial: '' },
      ...(opts.sortable && { sort: { type: 'string', initial: 'desc' } }),
    },
    $queries: {
      [key]: {
        entity: opts.entity,
        dataset: 'datasetStore.marketplaceDataset',
        subscribe: true,
        ...(opts.sortable && { order: { createdAt: { $local: 'sort' } } }),
        ...(opts.include && { include: opts.include }),
      },
    },
    children: [
      {
        type: 'Row',
        props: grid ? { gap: '300', ay: 'center', maxWidth: '1200px', width: '100%' } : { width: '100%' },
        children: [
          {
            type: 'Search',
            props: {
              ...(grid && { bg: 'surface-sunken', border: '1px solid border-strong', maxWidth: '300px' }),
              placeholder: `Search ${opts.label}…`,
              value: { $local: 'search' },
              // `$arg` rather than `$event.detail`: `Search` is a layer-4 component and calls its
              // handler with the value itself, not with a DOM event.
              onSearch: { $setLocal: 'search', from: '$arg' },
              width: '100%',
            },
          },
          ...(opts.sortable
            ? [
                {
                  type: 'we-select',
                  props: {
                    value: { $local: 'sort' },
                    options: [
                      { value: 'desc', label: 'Newest first' },
                      { value: 'asc', label: 'Oldest first' },
                    ],
                    onChange: { $setLocal: 'sort', from: '$event.detail' },
                  },
                } as SchemaNode,
              ]
            : []),
        ],
      },
      {
        /*
          Three states, not two: still loading, loaded and empty, and loaded with nothing *matching*.

          It gated on the unfiltered count with no `Loaded` check — though the `$queries` entry
          right above exposes one — so every marketplace page flashed "No … available yet" on load,
          across four routes. And because the count ignored the search box while the grid honoured
          it, a search with no matches rendered a blank area with no message at all: the count said
          "there are items", the grid drew none, and nothing explained the difference.
        */
        type: '$if',
        props: {
          condition: { $local: `${key}Loaded` },
          then: {
            type: '$if',
            props: {
              condition: { $count: { items: matching } },
              then: grid
                ? {
                    type: 'Column',
                    props: { flex: '1', gap: '0', maxWidth: '1200px', width: '100%' },
                    children: [{ type: 'Grid', props: { columns: 3, gap: '400', width: '100%' }, children: [rows] }],
                  }
                : { type: 'Column', props: { gap: '200' }, children: [rows] },
              // Two different absences, two different sentences. Saying "none available yet" to
              // somebody who has just typed a search is telling them the shelf is empty when what
              // is empty is their query.
              else: {
                type: '$if',
                props: {
                  condition: { $local: 'search' },
                  then: gatePrompt({
                    icon: 'magnifying-glass',
                    iconColor: 'neutral-300',
                    title: `No ${opts.label} match your search`,
                    body: 'Try a different word, or clear the search to see everything.',
                    fill: false,
                    gap: '300',
                    bodyWidth: '360px',
                  }),
                  else: gatePrompt({
                    icon: opts.emptyIcon,
                    iconColor: 'neutral-300',
                    title: `No ${opts.label} available yet`,
                    body: opts.emptyBody,
                    fill: false,
                    gap: '300',
                    bodyWidth: '360px',
                  }),
                },
              },
            },
          },
          // Still loading: nothing, rather than an assertion that there is nothing.
        },
      },
    ],
  };
}
