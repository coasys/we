import { AudioVisualiser } from '@we/components/solid';
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
          <Column>
            <Show when={props.title}>
              <we-text fontSize="400" color="neutral-700">
                {props.title}
              </we-text>
            </Show>
            <Show when={props.artist}>
              <we-text fontSize="400" color="neutral-500">
                {props.artist}
              </we-text>
            </Show>
          </Column>
        </Row>
        <AudioVisualiser src={props.audioUrl} />
      </Show>
    </Column>
  );
}
