import { Column, Row } from '@we/components/solid';
import { Show } from 'solid-js';

interface LinkDisplayProps {
  url: string | undefined;
  title: string | undefined;
  description: string | undefined;
  thumbnail: string | undefined;
}

export function LinkDisplay(props: LinkDisplayProps) {
  return (
    <div class="we-link-block">
      <Show when={props.url}>
        <we-link href={props.url} target="_blank" textDecoration="none" color="inherit">
          <Row gap="300" ay="center" p="300" border="1px solid neutral-200" r="300">
            <Show when={props.thumbnail}>
              <we-image src={props.thumbnail} alt="" width="80px" height="60px" r="200" fit="cover" />
            </Show>
            <Column gap="100" flex="1">
              <we-text variant="label">{props.title || props.url}</we-text>
              <Show when={props.description}>
                <we-text variant="footnote">{props.description}</we-text>
              </Show>
              <we-text variant="footnote" color="neutral-400">
                {props.url}
              </we-text>
            </Column>
          </Row>
        </we-link>
      </Show>
    </div>
  );
}
