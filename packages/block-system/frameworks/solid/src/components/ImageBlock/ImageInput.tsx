import { createEffect, createSignal, onCleanup, Show } from 'solid-js';

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
  const [showInputModal, setShowInputModal] = createSignal(false);
  const [imageUrl, setImageUrl] = createSignal('');
  let inputModalRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  function openInputModal(e: MouseEvent) {
    e.stopPropagation();
    setShowInputModal(true);
  }

  function closeInputModal() {
    setShowInputModal(false);
    setImageUrl('');
  }

  function handleUrlSubmit(e: Event) {
    e.preventDefault();
    if (imageUrl().trim()) {
      props.onChange('src', imageUrl().trim());
      closeInputModal();
    }
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    props.onChange('src', undefined);
  }

  // Close popup when clicking outside
  createEffect(() => {
    if (!showInputModal()) return;

    function handleClickOutside(e: MouseEvent) {
      if (inputModalRef && !inputModalRef.contains(e.target as Node)) closeInputModal();
    }

    if (inputRef) inputRef.focus();

    document.addEventListener('mousedown', handleClickOutside);
    onCleanup(() => document.removeEventListener('mousedown', handleClickOutside));
  });

  return (
    <div class="we-image-block" onClick={props.onSelect}>
      <Show
        when={props.src}
        fallback={
          <button onClick={openInputModal}>
            <we-icon name="image" size="lg" />
            Add Image
          </button>
        }
      >
        {/* Compose the display component — same rendering as read-only */}
        <ImageDisplay src={props.src} altText={props.altText} width={props.width} height={props.height} />

        {/* Edit affordances layered on top */}
        <Show when={props.isSelected()}>
          <button class="we-image-block-delete" onClick={handleDelete}>
            ×
          </button>
        </Show>
      </Show>

      <Show when={showInputModal()}>
        <div class="we-image-block-input-modal" ref={inputModalRef}>
          <form onSubmit={handleUrlSubmit}>
            <h4>Add Image URL</h4>
            <input
              ref={inputRef}
              type="text"
              value={imageUrl()}
              onInput={(e) => setImageUrl(e.currentTarget.value)}
              placeholder="https://example.com/image.jpg"
            />
            <div class="we-image-block-input-buttons">
              <button type="button" onClick={closeInputModal}>
                Cancel
              </button>
              <button type="submit">Add</button>
            </div>
          </form>
        </div>
      </Show>
    </div>
  );
}
