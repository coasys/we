import type { ImageCropRef } from '@we/components/solid';
import { Column, ImageCrop, Row } from '@we/components/solid';
import type { FileData } from '@we/models';
import { compressImageToFileData } from '@we/models';
import { createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { BlockPlaceholder } from '../BlockPlaceholder';
import { BlockToolbar } from '../BlockToolbar';
import { ImageDisplay } from './ImageDisplay';

interface ImageInputProps {
  src: string | FileData | undefined;
  altText: string | undefined;
  width: number | undefined;
  height: number | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

const WIDTH_PRESETS = [
  { label: 'S', value: 33 },
  { label: 'M', value: 66 },
  { label: 'L', value: 100 },
] as const;

/**
 * Input component for ImageBlock.
 * Pure SolidJS — no Lexical imports. Receives onChange from the factory.
 *
 * Empty state: BlockPlaceholder (dashed zone, icon, label).
 *   - Drop a file directly → goes straight to crop modal.
 *   - Click → opens the add-image modal (portalled outside the editor so
 *     shadow-DOM inputs work on first click).
 *
 * Add-image modal: we-file-upload + URL field + optional alt text.
 * Crop modal: portalled, for image positioning after file selection.
 *
 * Loaded state: ImageDisplay with a selection toolbar (width presets + delete).
 */
export function ImageInput(props: ImageInputProps) {
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [imageUrl, setImageUrl] = createSignal('');
  const [altText, setAltText] = createSignal('');
  const [rawUrl, setRawUrl] = createSignal<string | null>(null);
  const [pendingFile, setPendingFile] = createSignal<File | null>(null);
  let cropRef: ImageCropRef | undefined;

  const activeWidth = () => props.width || 33;

  // Derive a displayable URL from src (handles both string and FileData).
  const displaySrc = () => {
    const s = props.src;
    if (!s) return undefined;
    if (typeof s === 'string') return s;
    return `data:${s.file_type};base64,${s.data_base64}`;
  };

  // Shared: receive a File and move to the crop step.
  function receiveFile(file: File) {
    const old = rawUrl();
    if (old) URL.revokeObjectURL(old);
    setPendingFile(file);
    setRawUrl(URL.createObjectURL(file));
  }

  // File selected via we-file-upload inside the add modal.
  function handleModalFileChange(e: Event) {
    const file = (e as CustomEvent).detail as File | null;
    if (!file) return;
    setShowAddModal(false);
    receiveFile(file);
  }

  async function handleCropSave() {
    if (!cropRef) return;
    const file = await cropRef.getCroppedFile();
    const fileData = await compressImageToFileData(file, 'image-block');
    props.onChange('src', fileData);
    if (altText().trim()) props.onChange('altText', altText().trim());
    setRawUrl(null);
    setPendingFile(null);
    setAltText('');
    cropRef = undefined;
    setShowAddModal(false);
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
      if (altText().trim()) props.onChange('altText', altText().trim());
      setImageUrl('');
      setAltText('');
      setShowAddModal(false);
    }
  }

  function handleDelete() {
    props.onChange('src', undefined);
  }

  return (
    <Column position="relative">
      <Show
        when={props.src}
        fallback={
          <BlockPlaceholder
            icon="image"
            label="Add an image"
            hint="Drop here or click for options"
            accept="image/*"
            onFileDrop={receiveFile}
            onClick={() => setShowAddModal(true)}
          />
        }
      >
        <ImageDisplay src={displaySrc()} altText={props.altText} width={props.width} height={props.height} />

        {/* Selection toolbar */}
        <Show when={props.isSelected()}>
          <BlockToolbar>
            <For each={WIDTH_PRESETS}>
              {(preset) => (
                <we-button
                  square
                  variant={activeWidth() === preset.value ? 'secondary' : 'ghost'}
                  onClick={() => props.onChange('width', preset.value)}
                >
                  {preset.label}
                </we-button>
              )}
            </For>
            <we-divider orientation="vertical" my="300" mx="100" color="text-faint" />
            <we-button square variant="ghost" onClick={handleDelete}>
              <we-icon name="x" size="xs" />
            </we-button>
          </BlockToolbar>
        </Show>
      </Show>

      {/* Add-image modal — portalled to escape the Lexical contenteditable context. */}
      <Show when={showAddModal()}>
        <Portal>
          <we-modal close={() => setShowAddModal(false)}>
            <we-text fontWeight="bold" fontSize="600" textAlign="center">
              Add Image
            </we-text>

            <we-file-upload accept="image/*" on:change={handleModalFileChange} width="100%">
              <we-icon name="image" color="text-muted" size="lg" />
              <we-text color="text-muted" fontSize="400">
                Drop an image or click to browse
              </we-text>
            </we-file-upload>

            <Row ay="center" gap="200">
              <we-input
                type="text"
                value={imageUrl()}
                on:input={(e: CustomEvent) => setImageUrl(e.detail)}
                placeholder="Or paste an image URL…"
                flex="1"
              />
              <we-button onClick={handleUrlSubmit} disabled={!imageUrl().trim()}>
                Add
              </we-button>
            </Row>

            <we-input
              type="text"
              value={altText()}
              on:input={(e: CustomEvent) => setAltText(e.detail)}
              placeholder="Alt text (optional)"
              width="100%"
            />
          </we-modal>
        </Portal>
      </Show>

      {/* Crop modal — portalled to escape the Lexical contenteditable context. */}
      <Show when={rawUrl()}>
        <Portal>
          <we-modal close={handleCropBack}>
            <we-text fontSize="700" fontWeight="bold" textAlign="center">
              Crop Image
            </we-text>
            <ImageCrop
              src={rawUrl()!}
              fileName={pendingFile()?.name}
              onReady={(ref) => {
                cropRef = ref;
              }}
            />
            <Row ax="center" gap="300">
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
