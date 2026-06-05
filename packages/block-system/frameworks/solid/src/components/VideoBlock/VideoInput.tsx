import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { VideoDisplay } from './VideoDisplay';

interface VideoInputProps {
  url: string | undefined;
  title: string | undefined;
  thumbnail: string | undefined;
  provider: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

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
    setShowModal(false);
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (url().trim()) {
      props.onChange('url', url().trim());
      if (title().trim()) props.onChange('title', title().trim());
      closeModal();
    }
  }

  return (
    <Column class="we-video-block" position="relative">
      <Show
        when={props.url}
        fallback={
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder">
            <we-icon name="youtube-logo" />
            Add Video
          </we-button>
        }
      >
        <VideoDisplay {...props} />
        <Show when={props.isSelected()}>
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder" mt="300">
            Edit Video
          </we-button>
        </Show>
      </Show>

      <Show when={showModal()}>
        <we-modal close={closeModal} p="500" width="320px" r="300">
          <form onSubmit={handleSubmit}>
            <Column gap="300">
              <we-text variant="subheading">Add Video</we-text>
              <we-form-field label="Video URL">
                <we-input
                  type="text"
                  value={url()}
                  on:input={(e: CustomEvent) => setUrl(e.detail)}
                  placeholder="https://youtube.com/watch?v=... or .mp4 URL"
                />
              </we-form-field>
              <we-form-field label="Title">
                <we-input
                  type="text"
                  value={title()}
                  on:input={(e: CustomEvent) => setTitle(e.detail)}
                  placeholder="Video title"
                />
              </we-form-field>
              <Row ax="end" gap="200">
                <we-button variant="secondary" onClick={closeModal}>
                  Cancel
                </we-button>
                <we-button variant="primary" onClick={handleSubmit}>
                  Add
                </we-button>
              </Row>
            </Column>
          </form>
        </we-modal>
      </Show>
    </Column>
  );
}
