import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { ImageDisplay } from './ImageDisplay';

interface ImageInputProps {
  src: string | undefined;
  altText: string | undefined;
  width: number | undefined;
  height: number | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
  onSelect: (e: MouseEvent) => void;
}

/**
 * Input component for ImageBlock.
 * Pure SolidJS — no Lexical imports. Receives onChange from the factory.
 * Composes ImageDisplay when an image is loaded, with edit affordances overlaid.
 */
export function ImageInput(props: ImageInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [mode, setMode] = createSignal<'upload' | 'url'>('upload');
  const [imageUrl, setImageUrl] = createSignal('');

  function openModal(e: MouseEvent) {
    e.stopPropagation();
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setImageUrl('');
    setMode('upload');
  }

  function handleFileChange(e: Event) {
    const file = (e as CustomEvent).detail as File | null;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        props.onChange('src', reader.result);
        closeModal();
      }
    };
    reader.readAsDataURL(file);
  }

  function handleUrlSubmit() {
    const url = imageUrl().trim();
    if (url) {
      props.onChange('src', url);
      closeModal();
    }
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    props.onChange('src', undefined);
  }

  return (
    <Column class="we-image-block" onClick={props.onSelect} position="relative">
      <Show
        when={props.src}
        fallback={
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder">
            <we-icon name="image" />
            Add Image
          </we-button>
        }
      >
        <ImageDisplay src={props.src} altText={props.altText} width={props.width} height={props.height} />

        <Show when={props.isSelected()}>
          <Row gap="200" class="we-image-block-actions">
            <we-button variant="ghost" onClick={openModal}>
              <we-icon name="pencil-simple" size="sm" />
            </we-button>
            <we-button variant="ghost" onClick={handleDelete}>
              <we-icon name="x" size="sm" />
            </we-button>
          </Row>
        </Show>
      </Show>

      <Show when={showModal()}>
        <we-modal close={closeModal} p="500" width="400px" r="300">
          <Column gap="300">
            <we-text variant="subheading">{props.src ? 'Change Image' : 'Add Image'}</we-text>

            <Row gap="200">
              <we-button variant={mode() === 'upload' ? 'secondary' : 'ghost'} onClick={() => setMode('upload')}>
                Upload
              </we-button>
              <we-button variant={mode() === 'url' ? 'secondary' : 'ghost'} onClick={() => setMode('url')}>
                URL
              </we-button>
            </Row>

            <Show when={mode() === 'upload'}>
              <we-file-upload accept="image/*" on:change={handleFileChange}>
                <we-icon name="image" size="32px" color="neutral-300" />
                <we-text variant="footnote" color="neutral-400">
                  Drop an image or click to browse
                </we-text>
              </we-file-upload>
            </Show>

            <Show when={mode() === 'url'}>
              <we-form-field label="Image URL">
                <we-input
                  type="text"
                  value={imageUrl()}
                  on:input={(e: CustomEvent) => setImageUrl(e.detail)}
                  placeholder="https://example.com/image.jpg"
                />
              </we-form-field>
              <Row ax="end" gap="200">
                <we-button variant="secondary" onClick={closeModal}>
                  Cancel
                </we-button>
                <we-button variant="primary" onClick={handleUrlSubmit}>
                  Add
                </we-button>
              </Row>
            </Show>
          </Column>
        </we-modal>
      </Show>
    </Column>
  );
}
