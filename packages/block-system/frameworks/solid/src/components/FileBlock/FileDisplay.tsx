import { Column, Row } from '@we/components/solid';
import { Show } from 'solid-js';

interface FileDisplayProps {
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
    <div class="we-file-block">
      <Show when={props.url}>
        <we-link href={props.url} target="_blank" download={props.url?.startsWith('data:') ? props.name : undefined} textDecoration="none" color="inherit">
          <Row gap="300" ay="center" p="300" border="1px solid neutral-200" r="300">
            <we-icon name="paperclip" size="lg" />
            <Column flex="1">
              <we-text variant="label">{props.name || 'File'}</we-text>
              <Show when={props.size}>
                <we-text variant="footnote">{formatSize(props.size!)}</we-text>
              </Show>
            </Column>
            <we-icon name="download-simple" size="sm" />
          </Row>
        </we-link>
      </Show>
    </div>
  );
}
