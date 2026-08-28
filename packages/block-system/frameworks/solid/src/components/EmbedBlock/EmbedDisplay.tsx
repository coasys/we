import { parseRef } from '@we/backend-shared';
import { Column, Row } from '@we/components/solid';
import { Show } from 'solid-js';

interface EmbedDisplayProps {
  url: string | undefined;
  target: string | undefined;
  targetType: string | undefined;
  displayMode: string | undefined;
  /** How the referenced thing was called when it was embedded — see the model. */
  label?: string;
  thumbnail?: string;
  /** Go to the thing this points at. Absent outside a host that can navigate — the editor's preview. */
  onOpenRef?: (ref: string) => void;
}

/**
 * An embed: a URL from outside, or a reference to something inside WE.
 *
 * The two are not the same shape and cannot share a rendering. A `we:` reference is **not a URL** —
 * putting one in an `href` produces a link that goes nowhere, which is what happened before this
 * branch existed and is why `target` sat unused for as long as it did.
 *
 * The card is drawn from the snapshot the embed carries rather than by resolving the reference.
 * This runs in a paint path, and a paint path must not do a cross-dataset lookup: the row would
 * flash empty on every render, and a reference into a space this agent has left would never
 * resolve at all. An embed written before the snapshot existed falls back to its entity name, which
 * is honest — it says what kind of thing it is and offers the way to it.
 */
export function EmbedDisplay(props: EmbedDisplayProps) {
  const reference = () => parseRef(props.target);
  const externalUrl = () => (reference() ? '' : props.url || props.target);

  return (
    <div class="we-embed-block">
      <Show when={reference()}>
        {(ref) => {
          const card = (
            <Row gap="300" ay="center" p="300" border="1px solid border" r="300" width="100%">
              <Show when={props.thumbnail} fallback={<we-icon name="bookmark-simple" size="lg" color="text-muted" />}>
                <we-image src={props.thumbnail} width="48px" height="48px" fit="cover" r="media" />
              </Show>
              <Column gap="100" flex="1" minWidth="0">
                <we-text truncate>{props.label || ref().entity || 'Something in WE'}</we-text>
                <we-text variant="footnote" color="text-faint" truncate>
                  {ref().entity || 'Reference'}
                </we-text>
              </Column>
              <Show when={props.onOpenRef}>
                <we-icon name="arrow-square-out" color="text-faint" />
              </Show>
            </Row>
          );
          // No handler means nobody here can navigate — the composer, where you are editing rather
          // than following. A plain card rather than a dead button: a control that cannot be pressed
          // still invites the press.
          return (
            <Show when={props.onOpenRef} fallback={card}>
              <we-button variant="bare" width="100%" onClick={() => props.onOpenRef?.(props.target ?? '')}>
                {card}
              </we-button>
            </Show>
          );
        }}
      </Show>

      <Show when={!reference()}>
        <Show
          when={externalUrl()}
          fallback={
            <we-text variant="footnote" color="text-faint">
              No embed URL
            </we-text>
          }
        >
          <Show
            when={props.displayMode !== 'card'}
            fallback={
              <we-link href={externalUrl()} target="_blank" textDecoration="none" color="inherit">
                <Row gap="300" ay="center" p="300" border="1px solid border" r="300">
                  <we-icon name="link" size="lg" />
                  <we-text>{externalUrl()}</we-text>
                </Row>
              </we-link>
            }
          >
            <we-iframe
              src={externalUrl()}
              sandbox="allow-scripts allow-same-origin allow-popups"
              r="300"
              height="300px"
            />
          </Show>
        </Show>
      </Show>
    </div>
  );
}
