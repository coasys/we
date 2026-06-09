import { Column, Row } from '@we/components/solid';
import { Show } from 'solid-js';

interface FileDisplayProps {
  title: string | undefined;
  name: string | undefined;
  url: string | undefined;
  mimeType: string | undefined;
  size: number | undefined;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileDisplay(props: FileDisplayProps) {
  return (
    <Column class="we-file-block" gap="200">
      <Show when={props.url}>
        <we-link
          href={props.url}
          target="_blank"
          download={props.url?.startsWith('data:') ? props.name : undefined}
          textDecoration="none"
          display="flex"
        >
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
            <we-icon name="download-simple" color="neutral-500" />
            <Column gap="100" flex="1">
              <we-text fontSize="500" color="neutral-800">
                {props.title || props.name || 'File'}
              </we-text>
              <Show when={props.size}>
                <we-text fontSize="400" color="neutral-600">
                  {formatSize(props.size!)}
                </we-text>
              </Show>
            </Column>
            <we-icon name="download-simple" color="neutral-500" size="sm" />
          </Row>
        </we-link>
      </Show>
    </Column>
  );
}
