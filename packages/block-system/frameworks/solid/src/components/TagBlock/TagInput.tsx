import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { TagDisplay } from './TagDisplay';

interface TagInputProps {
  name: string | undefined;
  color: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

export function TagInput(props: TagInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [name, setName] = createSignal('');
  const [color, setColor] = createSignal('#3b82f6');

  function openModal() {
    setName(props.name || '');
    setColor(props.color || '#3b82f6');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (name().trim()) {
      props.onChange('name', name().trim());
      props.onChange('color', color());
      closeModal();
    }
  }

  return (
    <Column class="we-tag-block-wrapper" position="relative" display="inline-block">
      <Show
        when={props.name}
        fallback={
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder">
            <we-icon name="tag" />
            Add Tag
          </we-button>
        }
      >
        <TagDisplay {...props} />
        <Show when={props.isSelected()}>
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder" mt="300">
            Edit Tag
          </we-button>
        </Show>
      </Show>

      <Show when={showModal()}>
        <we-modal close={closeModal} p="500" width="320px" r="300">
          <form onSubmit={handleSubmit}>
            <Column gap="300">
              <we-text variant="subheading">Add Tag</we-text>
              <we-form-field label="Tag Name">
                <we-input
                  type="text"
                  value={name()}
                  on:input={(e: CustomEvent) => setName(e.detail)}
                  placeholder="Tag name"
                />
              </we-form-field>
              <we-form-field label="Color">
                <we-color-picker value={color()} onChange={(e: CustomEvent) => setColor(e.detail)} />
              </we-form-field>
              <Row ax="end" gap="200">
                <we-button variant="secondary" onClick={closeModal}>
                  Cancel
                </we-button>
                <we-button variant="primary" onClick={handleSubmit} disabled={!name().trim()}>
                  Save
                </we-button>
              </Row>
            </Column>
          </form>
        </we-modal>
      </Show>
    </Column>
  );
}
