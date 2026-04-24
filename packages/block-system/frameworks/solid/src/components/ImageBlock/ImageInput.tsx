import type { ImageCropRef } from '@we/components/solid';
import { Column, ImageCrop, Row } from '@we/components/solid';
import { createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

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

const WIDTH_PRESETS = [
  { label: 'S', value: 33 },
  { label: 'M', value: 66 },
  { label: 'L', value: 100 },
] as const;

/**
 * Input component for ImageBlock.
 * Pure SolidJS — no Lexical imports. Receives onChange from the factory.
 * Composes ImageDisplay when an image is loaded, with edit affordances overlaid.
 *
 * UX: upload and URL input are shown simultaneously — no mode toggle needed.
 * Width is stored as a percentage (33 / 66 / 100) and chosen via S/M/L presets
 * that appear in the selection toolbar. Cropping is the one modal exception
 * because the crop tool requires a minimum 520px canvas.
 */
export function ImageInput(props: ImageInputProps) {
  const [editing, setEditing] = createSignal(false);
  const [imageUrl, setImageUrl] = createSignal('');
  const [rawUrl, setRawUrl] = createSignal<string | null>(null);
  const [pendingFile, setPendingFile] = createSignal<File | null>(null);
  let cropRef: ImageCropRef | undefined;

  const showInput = () => !props.src || editing();
  const activeWidth = () => props.width ?? 33;

  function cancelEdit() {
    setEditing(false);
    setImageUrl('');
    const url = rawUrl();
    if (url) URL.revokeObjectURL(url);
    setRawUrl(null);
    setPendingFile(null);
    cropRef = undefined;
  }

  function handleFileChange(e: Event) {
    const file = (e as CustomEvent).detail as File | null;
    if (!file) return;
    const old = rawUrl();
    if (old) URL.revokeObjectURL(old);
    setPendingFile(file);
    setRawUrl(URL.createObjectURL(file));
  }

  async function handleCropSave() {
    if (!cropRef) return;
    const file = await cropRef.getCroppedFile();
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        props.onChange('src', reader.result);
        setRawUrl(null);
        setPendingFile(null);
        setEditing(false);
        cropRef = undefined;
      }
    };
    reader.readAsDataURL(file);
  }

  function handleCropBack() {
    const url = rawUrl();
    if (url) URL.revokeObjectURL(url);
    setRawUrl(null);
    setPendingFile(null);
    cropRef = undefined;
  }

  function handleUrlSubmit() {
    const url = imageUrl().trim();
    if (url) {
      props.onChange('src', url);
      setImageUrl('');
      setEditing(false);
    }
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    props.onChange('src', undefined);
  }

  return (
    <Column class="we-image-block" onClick={props.onSelect} position="relative">
      <Show
        when={!showInput()}
        fallback={
          <Column class="we-image-block-input" gap="400" ax="center">
            <we-file-upload accept="image/*" on:change={handleFileChange}>
              <we-icon name="image" color="neutral-500" />
              <we-text color="neutral-500">Drop an image or click to browse</we-text>
            </we-file-upload>

            <Row gap="300" ax="center">
              <we-input
                type="text"
                value={imageUrl()}
                on:input={(e: CustomEvent) => setImageUrl(e.detail)}
                placeholder="Paste image URL…"
                width="100%"
              />
              <we-button onClick={handleUrlSubmit}>Add</we-button>
            </Row>

            <Show when={editing()}>
              <Row ax="end">
                <we-button variant="ghost" onClick={cancelEdit}>
                  Cancel
                </we-button>
              </Row>
            </Show>
          </Column>
        }
      >
        <ImageDisplay src={props.src} altText={props.altText} width={props.width} height={props.height} />

        <Show when={props.isSelected()}>
          <Row class="we-image-block-actions" gap="100">
            <For each={WIDTH_PRESETS}>
              {(preset) => (
                <we-button
                  variant={activeWidth() === preset.value ? 'secondary' : 'ghost'}
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    props.onChange('width', preset.value);
                  }}
                >
                  {preset.label}
                </we-button>
              )}
            </For>
            <div class="we-image-block-actions-sep" />
            <we-button variant="ghost" onClick={() => setEditing(true)}>
              <we-icon name="pencil-simple" size="sm" />
            </we-button>
            <we-button variant="ghost" onClick={handleDelete}>
              <we-icon name="x" size="sm" />
            </we-button>
          </Row>
        </Show>
      </Show>

      {/* Crop modal — portalled to document.body to escape the Lexical contenteditable
          context, which causes browsers to miscalculate containing blocks for
          shadow-DOM absolute children ([part="close-button-wrapper"]) and light-DOM
          web-component sizing (we-tooltip). */}
      <Show when={rawUrl()}>
        <Portal>
          <we-modal close={handleCropBack} p="500" r="300">
            <we-text variant="heading">Crop Image</we-text>
            <ImageCrop
              src={rawUrl()!}
              fileName={pendingFile()?.name}
              onReady={(ref) => {
                cropRef = ref;
              }}
            />
            <Row ax="end" gap="200">
              <we-button variant="secondary" onClick={handleCropBack}>
                Back
              </we-button>
              <we-button onClick={handleCropSave}>Save</we-button>
            </Row>
          </we-modal>
        </Portal>
      </Show>
    </Column>
  );
}
