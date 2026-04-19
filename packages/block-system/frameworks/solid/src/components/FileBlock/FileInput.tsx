import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { FileDisplay } from './FileDisplay';

interface FileInputProps {
  name: string | undefined;
  url: string | undefined;
  mimeType: string | undefined;
  size: number | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
  onSelect: (e: MouseEvent) => void;
}

export function FileInput(props: FileInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [url, setUrl] = createSignal('');
  const [name, setName] = createSignal('');

  function openModal(e: MouseEvent) {
    e.stopPropagation();
    setUrl(props.url || '');
    setName(props.name || '');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (url().trim()) {
      props.onChange('url', url().trim());
      props.onChange('name', name().trim() || 'File');
      closeModal();
    }
  }

  return (
    <Column class="we-file-block" onClick={props.onSelect} position="relative">
      <Show
        when={props.url}
        fallback={
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder">
            <we-icon name="paperclip" />
            Add File
          </we-button>
        }
      >
        <FileDisplay {...props} />
        <Show when={props.isSelected()}>
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder" mt="300">
            Edit File
          </we-button>
        </Show>
      </Show>

      <Show when={showModal()}>
        <we-modal close={closeModal} p="500" width="320px" r="300">
          <form onSubmit={handleSubmit}>
            <Column gap="300">
              <we-text variant="subheading">Add File</we-text>
              <we-form-field label="File URL">
                <we-input
                  type="text"
                  value={url()}
                  onInput={(e: CustomEvent) => setUrl(e.detail)}
                  placeholder="https://example.com/file.pdf"
                />
              </we-form-field>
              <we-form-field label="File Name">
                <we-input
                  type="text"
                  value={name()}
                  onInput={(e: CustomEvent) => setName(e.detail)}
                  placeholder="document.pdf"
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
