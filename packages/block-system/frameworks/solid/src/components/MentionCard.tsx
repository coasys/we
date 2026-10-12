/**
 * Who a mention names, shown on hover: their face and their name as it is now.
 *
 * A mention chip carries the name as it was typed, which is what a reader needs while reading and
 * not enough to know who is meant: two members can share a name, and a name changes. The card
 * answers from the host's profiles rather than from the chip, so it is right after a rename and puts
 * a face beside the words.
 *
 * One listener at the root of whatever draws the words — a renderer or a composer — rather than one
 * per chip, because the chips are drawn by the editor schema's serializer as plain spans and there is
 * no component per chip to attach anything to. `data-did` on the span is the whole contract.
 *
 * Shown after a short pause, so a pointer travelling across a paragraph does not flash a card for
 * every name it crosses, and gone the moment the pointer leaves the chip or the page scrolls under
 * it — a card left floating over text that has moved points at the wrong words.
 */
import type { JSX } from 'solid-js';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { useBlockHost } from './BlockHost';

/** How long the pointer rests on a chip before the card shows. */
const SHOW_AFTER_MS = 300;

interface Shown {
  did: string;
  /** The chip's own words, for when the host knows nothing about the person. */
  label: string;
  left: number;
  top: number;
}

export function MentionCard(props: { root: () => HTMLElement | undefined }): JSX.Element {
  const host = useBlockHost();
  const [shown, setShown] = createSignal<Shown | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chip: HTMLElement | null = null;

  const hide = () => {
    clearTimeout(timer);
    chip = null;
    setShown(null);
  };

  const over = (event: MouseEvent) => {
    const target = (event.target as HTMLElement | null)?.closest?.('.we-mention[data-did]') as HTMLElement | null;
    if (!target || target === chip) return;
    chip = target;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (chip !== target || !target.isConnected) return;
      const rect = target.getBoundingClientRect();
      setShown({
        did: target.dataset.did ?? '',
        label: (target.textContent ?? '').replace(/^@/, ''),
        left: rect.left,
        top: rect.bottom + 6,
      });
    }, SHOW_AFTER_MS);
  };

  const out = (event: MouseEvent) => {
    if (!chip) return;
    const to = event.relatedTarget as Node | null;
    if (to && chip.contains(to)) return;
    hide();
  };

  onMount(() => {
    const el = props.root();
    if (!el) return;
    el.addEventListener('mouseover', over);
    el.addEventListener('mouseout', out);
    window.addEventListener('scroll', hide, true);
    onCleanup(() => {
      el.removeEventListener('mouseover', over);
      el.removeEventListener('mouseout', out);
      window.removeEventListener('scroll', hide, true);
      clearTimeout(timer);
    });
  });

  return (
    <Show when={shown()}>
      {(card) => {
        const person = () => host.person?.(card().did);
        const name = () => person()?.name || card().label;
        return (
          <Portal>
            <div
              class="we-mention-card"
              role="tooltip"
              style={{
                left: `${Math.max(8, Math.min(card().left, window.innerWidth - 248))}px`,
                top: `${card().top}px`,
              }}
            >
              <we-avatar image={person()?.avatar ?? ''} hash={card().did} initials={name()} size="sm" />
              <we-text truncate>{name()}</we-text>
            </div>
          </Portal>
        );
      }}
    </Show>
  );
}
