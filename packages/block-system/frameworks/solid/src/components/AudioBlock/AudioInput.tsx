import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { AudioDisplay } from './AudioDisplay';

interface AudioInputProps {
  title: string | undefined;
  artist: string | undefined;
  audioUrl: string | undefined;
  duration: number | undefined;
  albumArt: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
  onSelect: (e: MouseEvent) => void;
}

export function AudioInput(props: AudioInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [url, setUrl] = createSignal('');
  const [title, setTitle] = createSignal('');
  const [artist, setArtist] = createSignal('');

  function openModal(e: MouseEvent) {
    e.stopPropagation();
    setUrl(props.audioUrl || '');
    setTitle(props.title || '');
    setArtist(props.artist || '');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (url().trim()) {
      props.onChange('audioUrl', url().trim());
      if (title().trim()) props.onChange('title', title().trim());
      if (artist().trim()) props.onChange('artist', artist().trim());
      closeModal();
    }
  }

  return (
    <Column class="we-audio-block" onClick={props.onSelect} position="relative">
      <Show
        when={props.audioUrl}
        fallback={
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder">
            <we-icon name="speaker-high" />
            Add Audio
          </we-button>
        }
      >
        <AudioDisplay {...props} />
        <Show when={props.isSelected()}>
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder" mt="300">
            Edit Audio
          </we-button>
        </Show>
      </Show>

      <Show when={showModal()}>
        <we-modal close={closeModal} p="500" width="320px" r="300">
          <form onSubmit={handleSubmit}>
            <Column gap="300">
              <we-text variant="subheading">Add Audio</we-text>
              <we-form-field label="Audio URL">
                <we-input
                  type="text"
                  value={url()}
                  on:input={(e: CustomEvent) => setUrl(e.detail)}
                  placeholder="https://example.com/audio.mp3"
                />
              </we-form-field>
              <we-form-field label="Title">
                <we-input
                  type="text"
                  value={title()}
                  on:input={(e: CustomEvent) => setTitle(e.detail)}
                  placeholder="Track title"
                />
              </we-form-field>
              <we-form-field label="Artist">
                <we-input
                  type="text"
                  value={artist()}
                  on:input={(e: CustomEvent) => setArtist(e.detail)}
                  placeholder="Artist name"
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
