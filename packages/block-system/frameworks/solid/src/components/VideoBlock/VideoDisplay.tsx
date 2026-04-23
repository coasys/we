import { Column, Row } from '@we/components/solid';
import { createMemo, Show } from 'solid-js';

interface VideoDisplayProps {
  url: string | undefined;
  title: string | undefined;
  thumbnail: string | undefined;
  provider: string | undefined;
}

function getEmbedUrl(url: string): string | undefined {
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;

  return undefined;
}

function isDirectVideo(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
}

export function VideoDisplay(props: VideoDisplayProps) {
  const embedUrl = createMemo(() => (props.url ? getEmbedUrl(props.url) : undefined));

  return (
    <Column class="we-video-block" gap="200">
      <Show when={props.url}>
        <Show
          when={embedUrl()}
          fallback={
            <Show
              when={isDirectVideo(props.url!)}
              fallback={
                <we-link href={props.url} target="_blank" textDecoration="none" color="inherit">
                  <Row gap="200" ay="center">
                    <we-icon name="youtube-logo" size="lg" />
                    <we-text>{props.title || props.url}</we-text>
                  </Row>
                </we-link>
              }
            >
              <we-video controls preload="metadata" src={props.url} r="300" />
            </Show>
          }
        >
          <we-iframe
            src={embedUrl()}
            title={props.title || 'Video'}
            r="300"
            styles={{ 'aspect-ratio': '16/9' }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        </Show>
        <Show when={props.title}>
          <we-text variant="footnote">{props.title}</we-text>
        </Show>
      </Show>
    </Column>
  );
}
