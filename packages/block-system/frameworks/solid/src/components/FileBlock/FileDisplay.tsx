import { Column, Row } from '@we/components/solid';
import { dataUriToBlob, saveFile } from '@we/design-utils';
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
  /*
    A file stored inline is saved through `saveFile`, as every download in WE is: a save dialog where
    the environment has one, rather than the link's own `download`, which drops the file wherever the
    browser last put one. A file at a URL still opens it — there is nothing held here to save.

    `on:click`, a direct listener, rather than `onClick`: Solid's delegation does not reliably see a
    click from inside a web component's shadow root, and cancelling the link has to happen on that
    same event.
  */
  const saveInline = (event: Event) => {
    const url = props.url;
    if (!url?.startsWith('data:')) return;
    event.preventDefault();
    void saveFile({
      name: props.name || props.title || 'file',
      type: props.mimeType || 'application/octet-stream',
      content: () => dataUriToBlob(url),
    }).catch((error) => console.error('FileDisplay: could not save the file', error));
  };

  return (
    <Column class="we-file-block" gap="200">
      <Show when={props.url}>
        <we-link
          on:click={saveInline}
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
            border="1px solid border-strong"
            r="400"
            width="100%"
            bg="surface-sunken"
            hoverProps={{ bg: 'surface-sunken' }}
          >
            <we-icon name="download-simple" color="text-muted" />
            <Column gap="100" flex="1">
              <we-text fontSize="500" color="text">
                {props.title || props.name || 'File'}
              </we-text>
              <Show when={props.size}>
                <we-text fontSize="400" color="text-muted">
                  {formatSize(props.size!)}
                </we-text>
              </Show>
            </Column>
            <we-icon name="download-simple" color="text-muted" size="sm" />
          </Row>
        </we-link>
      </Show>
    </Column>
  );
}
