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
    <Column class="we-link-block" gap="200">
      <Show when={props.url}>
        <we-link href={props.url} target="_blank" textDecoration="none" display="flex">
          <Row
            gap="400"
            ay="center"
            p="400"
            border="1px solid neutral-300"
            r="400"
            width="100%"
            bg="neutral-75"
            hoverProps={{ bg: 'neutral-100' }}
          >
            <we-icon name="link" color="neutral-500" />
            <Show when={props.thumbnail}>
              <we-image src={props.thumbnail} alt="" width="80px" height="60px" r="200" fit="cover" />
            </Show>
            <Column gap="100" flex="1">
              <we-text fontSize="500" color="neutral-800">
                {props.title || props.url}
              </we-text>
              <Show when={props.description}>
                <we-text fontSize="400" color="neutral-600">
                  {props.description}
                </we-text>
              </Show>
              <we-text fontSize="400">{props.url}</we-text>
            </Column>
          </Row>
        </we-link>
      </Show>
    </Column>
  );
}
