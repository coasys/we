import { getBlockRegistration } from '@we/block-shared';
import { Column, Row } from '@we/components/solid';
import { For, Show } from 'solid-js';

/** Fields a block carries for bookkeeping, never for a reader. */
const HIDDEN = new Set(['_type', '_key', 'id', 'version', '__assetNames']);

/** Names that read as what a record is called, in the order worth trying them. */
const NAME_LIKE = ['title', 'name', 'question', 'label'];

/** `startDate` → `Start date`; `pollBlock` → `Poll block`. */
function humanise(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A value short enough to be one line of a card. */
function isLine(value: unknown): value is string | number {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.trim() !== '' && value.length <= 140 && !value.startsWith('data:'))
  );
}

/**
 * What a block is drawn as when nothing here can draw it.
 *
 * Two cases reach it: a block type this build has no display for — a module somebody else has
 * installed, whose card never arrived here — and a registration with no display and no card. Both
 * used to render "Unsupported block: poll", which says the reader's app is at fault and shows none
 * of what the author wrote.
 *
 * So it shows what it can read: the kind of thing, a name-like field as the heading, and a few short
 * values beneath. Not a substitute for the block's own card, and it says so quietly — dashed, like
 * the unknown block it replaces — so nobody mistakes it for the real presentation.
 */
export function FallbackBlockCard(props: { block: Record<string, unknown>; type: string }) {
  const kind = () => humanise(getBlockRegistration(props.type)?.entity?.replace(/Block$/, '') || props.type);
  const heading = () => {
    const key = NAME_LIKE.find((name) => isLine(props.block[name]));
    return key ? { key, text: String(props.block[key]) } : undefined;
  };
  const lines = () =>
    Object.entries(props.block)
      .filter(([name, value]) => !HIDDEN.has(name) && name !== heading()?.key && isLine(value))
      .slice(0, 3);

  return (
    <Column class="we-unknown-block" gap="100" data-block-type={props.type}>
      <we-text variant="footnote" color="text-muted">
        {kind()}
      </we-text>
      <Show when={heading()}>{(h) => <we-text fontWeight="semibold">{h().text}</we-text>}</Show>
      <For each={lines()}>
        {([name, value]) => (
          <Row gap="200" wrap>
            <we-text variant="footnote" color="text-muted">
              {humanise(name)}
            </we-text>
            <we-text variant="footnote">{String(value)}</we-text>
          </Row>
        )}
      </For>
    </Column>
  );
}
