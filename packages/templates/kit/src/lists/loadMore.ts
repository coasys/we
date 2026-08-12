/**
 * A "load more" button for a query-backed list.
 *
 * ## How paging works here, and what it costs
 *
 * The query's `limit` reads a `$local` number; the button raises it. `limit` is deep-resolved on
 * every render, so raising it re-runs the query with a bigger window and the list grows. That is
 * the whole mechanism — no cursor, no accumulation, no store.
 *
 * The cost, stated plainly because it is real: **each page refetches everything before it.** Page
 * five is one query for a hundred rows, not a query for the twenty new ones. That is fine for the
 * hundreds a template shows and wrong for the tens of thousands a busy channel holds, and the fix
 * is cursor paging in the query IR (`Page` already has an `after` variant) plus windowed rendering
 * — neither of which exists yet. Until then this is honest and small, and the alternative is lists
 * that silently stop at their first page.
 *
 * The button hides itself when the last page came back short, which is the only signal available
 * without a total count: fewer rows than asked for means there is no next page. It cannot
 * distinguish "exactly a full page and no more" from "exactly a full page and one more", so in
 * that case it shows once and the next press returns the same rows. Harmless, and the alternative
 * is a count query per render.
 */
import type { SchemaNode } from '@we/schema-shared';

export interface LoadMoreOptions {
  /** The `$localState` number field holding the current limit. */
  field: string;
  /** The `$queries` key holding the rows, so the button can tell whether a page came back full. */
  rowsLocal: string;
  /** How many rows a page adds. */
  pageSize: number;
  /** Button text. Defaults to "Load more". */
  label?: string;
}

export function loadMore(opts: LoadMoreOptions): SchemaNode {
  return {
    type: '$if',
    props: {
      // A short page means the end. `$gte` does not exist, so this is `not less-than`.
      condition: { $not: { $lt: [{ $count: { items: { $local: opts.rowsLocal } } }, { $local: opts.field }] } },
      then: {
        type: 'Row',
        props: { ax: 'center', width: '100%', py: '300' },
        children: [
          {
            type: 'we-button',
            props: {
              variant: 'ghost',
              size: 'sm',
              onClick: { $setLocal: opts.field, by: opts.pageSize },
            },
            children: [opts.label ?? 'Load more'],
          },
        ],
      },
    },
  };
}
