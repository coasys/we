import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { LinkDisplay } from './LinkDisplay';

interface LinkInputProps {
  url: string | undefined;
  title: string | undefined;
  description: string | undefined;
  thumbnail: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
  onSelect: (e: MouseEvent) => void;
}

export function LinkInput(props: LinkInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [url, setUrl] = createSignal('');
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');

  function openModal(e: MouseEvent) {
    e.stopPropagation();
    setUrl(props.url || '');
    setTitle(props.title || '');
    setDescription(props.description || '');
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
      if (description().trim()) props.onChange('description', description().trim());
      closeModal();
    }
  }

  return (
    <Column class="we-link-block" onClick={props.onSelect} position="relative">
      <Show
        when={props.url}
        fallback={
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder">
            <we-icon name="link" />
            Add Link
          </we-button>
        }
      >
        <LinkDisplay {...props} />
        <Show when={props.isSelected()}>
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder" mt="300">
            Edit Link
          </we-button>
        </Show>
      </Show>

      <Show when={showModal()}>
        <we-modal close={closeModal} p="500" width="320px" r="300">
          <form onSubmit={handleSubmit}>
            <Column gap="300">
              <we-text variant="subheading">Add Link</we-text>
              <we-form-field label="URL">
                <we-input
                  type="text"
                  value={url()}
                  on:input={(e: CustomEvent) => setUrl(e.detail)}
                  placeholder="https://example.com"
                />
              </we-form-field>
              <we-form-field label="Title">
                <we-input
                  type="text"
                  value={title()}
                  on:input={(e: CustomEvent) => setTitle(e.detail)}
                  placeholder="Link title"
                />
              </we-form-field>
              <we-form-field label="Description">
                <we-input
                  type="text"
                  value={description()}
                  on:input={(e: CustomEvent) => setDescription(e.detail)}
                  placeholder="Brief description"
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
