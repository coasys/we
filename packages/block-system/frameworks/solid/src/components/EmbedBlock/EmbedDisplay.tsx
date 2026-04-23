import { Row } from '@we/components/solid';
import { Show } from 'solid-js';

interface EmbedDisplayProps {
  url: string | undefined;
  target: string | undefined;
  targetType: string | undefined;
  displayMode: string | undefined;
}

export function EmbedDisplay(props: EmbedDisplayProps) {
  const embedUrl = () => props.url || props.target;

  return (
    <div class="we-embed-block">
      <Show
        when={embedUrl()}
        fallback={
          <we-text variant="footnote" color="neutral-400">
            No embed URL
          </we-text>
        }
      >
        <Show
          when={props.displayMode !== 'card'}
          fallback={
            <we-link href={embedUrl()} target="_blank" textDecoration="none" color="inherit">
              <Row gap="300" ay="center" p="300" border="1px solid neutral-200" r="300">
                <we-icon name="link" size="lg" />
                <we-text>{embedUrl()}</we-text>
              </Row>
            </we-link>
          }
        >
          <we-iframe src={embedUrl()} sandbox="allow-scripts allow-same-origin allow-popups" r="300" height="300px" />
        </Show>
      </Show>
    </div>
  );
}
