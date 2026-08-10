import type { SchemaNode } from '@we/schema-shared';

export interface EmptyStateOptions {
  /** The content type's own icon — the same name the type picker uses for it. */
  icon: string;
  /** What the list would have held, as a plural noun phrase: `posts`, `Flux channels`. */
  label: string;
  /**
   * The list filters on `$local: 'searchText'`, so an empty result may only mean the search
   * excluded everything. Says that instead of asserting the space holds nothing.
   *
   * Only set this where a `searchText` local is actually in scope — reading one that was never
   * declared warns and resolves to nothing, which would leave the message permanently in its
   * "no search" form.
   */
  searchable?: boolean;
  /** Replaces the sentence entirely, for a list the `label` phrasing does not fit. */
  message?: unknown;
  /**
   * How long the placeholder stays invisible before fading in, in ms.
   *
   * A list backed by a query starts empty and *becomes* full a moment later, so "there is nothing
   * here" is the honest reading of the first frame and the wrong thing to show — the placeholder
   * would flash on every switch between content types. Staying transparent for longer than a query
   * takes means it is only ever seen when it is true; the node still mounts, so nothing about the
   * condition changes. Pass 0 for a placeholder whose condition is known synchronously.
   */
  delay?: number;
}

/**
 * What a list shows when it has nothing to show: the content type's icon, and a sentence naming
 * what is absent.
 *
 * ## Why a helper rather than a node per list
 *
 * Five of the card lists had one of these and the other nine had nothing, so switching content type
 * either explained the emptiness or left the page blank depending on which type you picked. The
 * difference was not a decision — it was that each one had been written by hand, and writing it
 * fourteen times is what made it easy to skip. One helper is also the only way the icon, the muted
 * colour and the wording stay in agreement as lists are added.
 *
 * Sized and centred rather than a bare line of text, because it stands in for a grid of cards: a
 * left-aligned sentence under a header reads as a caption for content that is about to appear.
 */
export function emptyState(opts: EmptyStateOptions): SchemaNode {
  const nothingHere = `This space doesn't have any ${opts.label}.`;
  const message =
    opts.message ??
    (opts.searchable
      ? {
          $if: {
            condition: { $local: 'searchText' },
            then: `No ${opts.label} match your search.`,
            else: nothingHere,
          },
        }
      : nothingHere);

  const placeholder: SchemaNode = {
    type: 'Column',
    props: { ax: 'center', ay: 'center', gap: '200', p: '600', width: '100%' },
    children: [
      { type: 'we-icon', props: { name: opts.icon, size: 'lg', color: 'neutral-400' } },
      { type: 'we-text', props: { color: 'neutral-400', textAlign: 'center' }, children: [message] },
    ],
  };

  const delay = opts.delay ?? 400;
  if (!delay) return placeholder;

  return {
    type: '$animate',
    props: { enterTransition: { type: 'fade', duration: 200, delay } },
    children: [placeholder],
  };
}
