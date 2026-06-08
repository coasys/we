import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { BlockPlaceholder } from '../BlockPlaceholder';
import { VideoDisplay } from './VideoDisplay';

interface VideoInputProps {
  url: string | undefined;
  title: string | undefined;
  thumbnail: string | undefined;
  provider: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

/**
 * Input component for VideoBlock.
 * Video is URL-only (YouTube, Vimeo, or direct .mp4/.webm links) —
 * file uploads are not supported due to file-size constraints.
 * Empty state: BlockPlaceholder (click only, no file drop).
 * Modal: URL field + optional title.
 * Loaded state: VideoDisplay with a delete toolbar when selected.
 */
export function VideoInput(props: VideoInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [url, setUrl] = createSignal('');
  const [title, setTitle] = createSignal('');

  function openModal() {
    setUrl(props.url || '');
    setTitle(props.title || '');
    setShowModal(true);
  }

  function closeModal() {
    setUrl('');
    setTitle('');
    setShowModal(false);
  }

  function handleSave() {
    const trimmedUrl = url().trim();
    if (!trimmedUrl) return;
    props.onChange('url', trimmedUrl);
    props.onChange('title', title().trim() || undefined);
    closeModal();
  }

  function handleDelete() {
    props.onChange('url', undefined);
    props.onChange('title', undefined);
  }

  return (
    <Column position="relative">
      <Show
        when={props.url}
        fallback={
          <BlockPlaceholder icon="youtube-logo" label="Add video" hint="Click to add a URL" onClick={openModal} />
        }
      >
        <VideoDisplay url={props.url} title={props.title} thumbnail={props.thumbnail} provider={props.provider} />
        <Show when={props.isSelected()}>
          <Row
            position="absolute"
            top="5px"
            right="5px"
            p="200"
            r="200"
            gap="200"
            border="1px solid var(--we-color-neutral-100)"
            bg="neutral-0"
          >
            <we-button square variant="ghost" onClick={openModal}>
              <we-icon name="pencil" size="xs" />
            </we-button>
            <we-button square variant="ghost" onClick={handleDelete}>
              <we-icon name="x" size="xs" />
            </we-button>
          </Row>
        </Show>
      </Show>

      {/* Add-video modal — portalled to escape the Lexical contenteditable context. */}
      <Show when={showModal()}>
        <Portal>
          <we-modal close={closeModal} ax="center" minWidth="400px">
            <we-text fontWeight="bold" fontSize="600" textAlign="center">
              Add Video
            </we-text>

            <we-input
              type="text"
              value={url()}
              on:input={(e: CustomEvent) => setUrl(e.detail)}
              placeholder="YouTube, Vimeo, or direct video URL…"
              width="100%"
            />

            <we-input
              type="text"
              value={title()}
              on:input={(e: CustomEvent) => setTitle(e.detail)}
              placeholder="Title (optional)"
              width="100%"
            />

            <Row gap="200" ax="center" width="100%">
              <we-button variant="ghost" onClick={closeModal}>
                Cancel
              </we-button>
              <we-button variant="primary" onClick={handleSave} disabled={!url().trim()}>
                Save
              </we-button>
            </Row>
          </we-modal>
        </Portal>
      </Show>
    </Column>
  );
}
