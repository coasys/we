import { designSystemKeys, filterProps, mergeProps } from '@we/design-utils';
import { buildLayoutStyles, useStateProps } from '@we/design-utils/solid';
import { createMemo, createSignal, Show, splitProps } from 'solid-js';

export type * from './EditableImage.types';
import { Column } from '../../layout/Column/Column.solid';
import { Row } from '../../layout/Row/Row.solid';
import { ImageCrop } from '../ImageCrop/ImageCrop.solid';
import type { ImageCropRef } from '../ImageCrop/ImageCrop.types';
import type { EditableImageProps } from './EditableImage.types';

const DEFAULTS: Partial<EditableImageProps> = {
  position: 'relative',
  width: '100%',
  height: '200px',
  overflow: 'hidden',
  cursor: 'pointer',
  bg: 'neutral-200',
};

const editableImageKeys = [...designSystemKeys, 'children'] as const;
const editableImageStyleKeys = editableImageKeys.filter((key) => key !== 'children');
const componentKeys = ['src', 'alt', 'fit', 'placeholderIcon', 'onImageChange', 'class', 'aspect', 'maxSize'] as const;

export function EditableImage(allProps: EditableImageProps) {
  const [dsProps, props] = splitProps(
    allProps,
    editableImageKeys as unknown as (keyof EditableImageProps)[],
    componentKeys as unknown as (keyof EditableImageProps)[],
  );
  const [modalOpen, setModalOpen] = createSignal(false);
  const [step, setStep] = createSignal<'upload' | 'crop'>('upload');
  const [rawUrl, setRawUrl] = createSignal<string | null>(null);
  const [pendingFile, setPendingFile] = createSignal<File | null>(null);

  // Imperative handle to ImageCrop — set once the crop component reports ready
  let cropRef: ImageCropRef | undefined;

  const baseStyle = createMemo(() => {
    const usedProps = filterProps(dsProps, editableImageStyleKeys);
    const merged = mergeProps(usedProps, DEFAULTS) as EditableImageProps;
    return { ...buildLayoutStyles(merged, 'column'), 'flex-shrink': '0' };
  });

  const hasStateProps = () => dsProps.hoverProps || dsProps.activeProps || dsProps.focusProps;
  const { style, handlers } = useStateProps(baseStyle, dsProps as EditableImageProps, 'column');

  function openModal() {
    setStep('upload');
    setRawUrl(null);
    setPendingFile(null);
    cropRef = undefined;
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    const url = rawUrl();
    if (url) URL.revokeObjectURL(url);
    setRawUrl(null);
    setPendingFile(null);
    cropRef = undefined;
  }

  function handleFileChange(e: Event) {
    const file = (e as CustomEvent).detail as File | null;
    if (!file || !file.type.startsWith('image/')) return;
    const old = rawUrl();
    if (old) URL.revokeObjectURL(old);
    setPendingFile(file);
    setRawUrl(URL.createObjectURL(file));
    setStep('crop');
  }

  function changePhoto() {
    const url = rawUrl();
    if (url) URL.revokeObjectURL(url);
    setRawUrl(null);
    setPendingFile(null);
    cropRef = undefined;
    setStep('upload');
  }

  async function confirm() {
    if (!cropRef) return;
    try {
      const file = await cropRef.getCroppedFile();
      props.onImageChange?.(file);
    } finally {
      closeModal();
    }
  }

  return (
    <>
      {/* Image display with hover overlay */}
      <div
        class={`editable-image ${props.class || ''}`}
        style={hasStateProps() ? style() : baseStyle()}
        onClick={openModal}
        {...(hasStateProps() ? handlers : {})}
      >
        <Show
          when={props.src}
          fallback={
            <Column width="100%" height="100%" ax="center" ay="center">
              <we-icon name={props.placeholderIcon || 'image'} size="32px" color="neutral-400" />
            </Column>
          }
        >
          <we-image
            src={props.src}
            alt={props.alt || ''}
            fit={props.fit || 'cover'}
            style={{ width: '100%', height: '100%' }}
          />
        </Show>

        {/* Hover overlay */}
        <Column class="editable-image__overlay" ax="center" ay="center" p="300" gap="200" position="absolute">
          <we-icon name="pencil" size="24px" color="#fff" />
          <we-text fontSize="400" fontWeight="semibold" color="#fff">
            Edit Image
          </we-text>
        </Column>
      </div>

      {/* Modal */}
      <Show when={modalOpen()}>
        <we-modal close={closeModal} gap="400" p="900" minWidth="460px">
          <Show
            when={step() === 'crop'}
            fallback={
              /* ── Step 1: Upload ── */
              <>
                <we-text fontSize="600" fontWeight="semibold">
                  {props.src ? 'Change Image' : 'Upload Image'}
                </we-text>
                <we-file-upload accept="image/*" on:change={handleFileChange}>
                  <we-icon name="upload-simple" size="32px" />
                  <span>Drop an image here or click to browse</span>
                </we-file-upload>
              </>
            }
          >
            {/* ── Step 2: Crop ── */}
            <we-text fontSize="600" fontWeight="semibold">
              Crop Image
            </we-text>
            <ImageCrop
              src={rawUrl()!}
              fileName={pendingFile()?.name}
              aspect={props.aspect}
              maxSize={props.maxSize}
              onReady={(ref) => {
                cropRef = ref;
              }}
            />
            <Row ax="end" gap="200">
              <we-button variant="secondary" onClick={changePhoto}>
                Change photo
              </we-button>
              <we-button onClick={confirm}>Save</we-button>
            </Row>
          </Show>
        </we-modal>
      </Show>
    </>
  );
}
