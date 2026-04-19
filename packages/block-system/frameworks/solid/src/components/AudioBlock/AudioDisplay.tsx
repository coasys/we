import { Column, Row } from '@we/components/solid';
import { Show } from 'solid-js';

interface AudioDisplayProps {
  title: string | undefined;
  artist: string | undefined;
  audioUrl: string | undefined;
  duration: number | undefined;
  albumArt: string | undefined;
}

export function AudioDisplay(props: AudioDisplayProps) {
  return (
    <Column class="we-audio-block" gap="200">
      <Show when={props.audioUrl}>
        <Row gap="300" ay="center">
          <Show when={props.albumArt}>
            <we-image
              src={props.albumArt}
              alt={props.title || 'Album art'}
              width="48px"
              height="48px"
              r="200"
              fit="cover"
            />
          </Show>
          <Column gap="0">
            <Show when={props.title}>
              <we-text variant="label">{props.title}</we-text>
            </Show>
            <Show when={props.artist}>
              <we-text variant="footnote">{props.artist}</we-text>
            </Show>
          </Column>
        </Row>
        <we-audio controls preload="metadata" src={props.audioUrl} />
      </Show>
    </Column>
  );
}
