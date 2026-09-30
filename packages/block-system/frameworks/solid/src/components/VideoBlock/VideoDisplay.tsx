import { Column, Row } from '@we/components/solid';
import { createMemo, Show } from 'solid-js';

interface VideoDisplayProps {
  url: string | undefined;
  title: string | undefined;
  thumbnail: string | undefined;
  provider: string | undefined;
  width: number | undefined;
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
  const containerWidth = () => `${props.width ?? 100}%`;

  return (
    <Column class="we-video-block" gap="300" width={containerWidth()} mx="auto">
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
                    <we-text fontSize="400" color="text">
                      {props.title || props.url}
                    </we-text>
                  </Row>
                </we-link>
              }
            >
              <we-video controls preload="metadata" src={props.url} r="300" width="100%" />
            </Show>
          }
        >
          {/* Padding-top trick: padding % is relative to width, giving a reliable 16:9 height */}
          <div style={{ position: 'relative', width: '100%', 'padding-top': '56.25%' }}>
            <we-iframe
              src={embedUrl()}
              title={props.title || 'Video'}
              r="300"
              position="absolute"
              top="0"
              left="0"
              width="100%"
              height="100%"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            />
          </div>
        </Show>
        <Show when={props.title}>
          <we-text fontSize="400" color="text">
            {props.title}
          </we-text>
        </Show>
      </Show>
    </Column>
  );
}
