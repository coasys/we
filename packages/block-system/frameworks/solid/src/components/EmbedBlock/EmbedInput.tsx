import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { EmbedDisplay } from './EmbedDisplay';

interface EmbedInputProps {
  url: string | undefined;
  target: string | undefined;
  targetType: string | undefined;
  displayMode: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

const DISPLAY_MODE_OPTIONS = [
  { label: 'Inline (iframe)', value: 'inline' },
  { label: 'Card (link preview)', value: 'card' },
];

export function EmbedInput(props: EmbedInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [url, setUrl] = createSignal('');
  const [displayMode, setDisplayMode] = createSignal('inline');

  function openModal() {
    setUrl(props.url || props.target || '');
    setDisplayMode(props.displayMode || 'inline');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (url().trim()) {
      props.onChange('url', url().trim());
      props.onChange('displayMode', displayMode());
      closeModal();
    }
  }

  return (
    <Column class="we-embed-block" position="relative">
      <Show
        when={props.url || props.target}
        fallback={
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder">
            <we-icon name="link" />
            Add Embed
          </we-button>
        }
      >
        <EmbedDisplay {...props} />
        <Show when={props.isSelected()}>
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder" mt="300">
            Edit Embed
          </we-button>
        </Show>
      </Show>

      <Show when={showModal()}>
        <we-modal close={closeModal} p="500" width="320px" r="300">
          <form onSubmit={handleSubmit}>
            <Column gap="300">
              <we-text variant="subheading">Add Embed</we-text>
              <we-form-field label="URL">
                <we-input
                  type="text"
                  value={url()}
                  on:input={(e: CustomEvent) => setUrl(e.detail)}
                  placeholder="https://example.com"
                />
              </we-form-field>
              <we-form-field label="Display Mode">
                <we-select
                  value={displayMode()}
                  options={DISPLAY_MODE_OPTIONS}
                  onChange={(e: CustomEvent) => setDisplayMode(e.detail)}
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
