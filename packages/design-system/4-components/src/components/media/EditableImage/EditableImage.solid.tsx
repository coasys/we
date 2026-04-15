import { designSystemKeys, filterProps, mergeProps } from '@we/design-utils';
import { buildLayoutStyles, useStateProps } from '@we/design-utils/solid';
import { createMemo, createSignal, Show, splitProps } from 'solid-js';

export type * from './EditableImage.types';
import { Column } from '../../layout/Column/Column.solid';
import { Row } from '../../layout/Row/Row.solid';
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
const componentKeys = ['src', 'alt', 'fit', 'placeholderIcon', 'onImageChange', 'class'] as const;

export function EditableImage(allProps: EditableImageProps) {
  const [dsProps, props] = splitProps(
    allProps,
    editableImageKeys as unknown as (keyof EditableImageProps)[],
    componentKeys as unknown as (keyof EditableImageProps)[],
  );
  const [modalOpen, setModalOpen] = createSignal(false);
  const [preview, setPreview] = createSignal<string | null>(null);
  const [pendingFile, setPendingFile] = createSignal<File | null>(null);

  const baseStyle = createMemo(() => {
    const usedProps = filterProps(dsProps, editableImageStyleKeys);
    const merged = mergeProps(usedProps, DEFAULTS) as EditableImageProps;
    return { ...buildLayoutStyles(merged, 'column'), 'flex-shrink': '0' };
  });

  const hasStateProps = () => dsProps.hoverProps || dsProps.activeProps || dsProps.focusProps;
  const { style, handlers } = useStateProps(baseStyle, dsProps as EditableImageProps, 'column');

  function openModal() {
    setPreview(null);
    setPendingFile(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    const url = preview();
    if (url) URL.revokeObjectURL(url);
    setPreview(null);
    setPendingFile(null);
  }

  function handleFileChange(e: Event) {
    const file = (e as CustomEvent).detail as File | null;
    if (!file || !file.type.startsWith('image/')) {
      setPendingFile(null);
      const old = preview();
      if (old) URL.revokeObjectURL(old);
      setPreview(null);
      return;
    }
    const old = preview();
    if (old) URL.revokeObjectURL(old);
    setPendingFile(file);
    setPreview(URL.createObjectURL(file));
  }

  function confirm() {
    const file = pendingFile();
    if (file && props.onImageChange) {
      props.onImageChange(file);
    }
    closeModal();
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
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
              }}
            >
              <we-icon name={props.placeholderIcon || 'image'} size="32px" color="neutral-400" />
            </div>
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

      {/* Upload modal */}
      <Show when={modalOpen()}>
        <we-modal close={closeModal} gap="400" p="900" minWidth="400px">
          <we-text fontSize="500" fontWeight="semibold">
            {props.src ? 'Change Image' : 'Upload Image'}
          </we-text>

          <we-file-upload accept="image/*" on:change={handleFileChange}>
            <we-icon name="upload-simple" size="32px"></we-icon>
            <span>Drop an image here or click to browse</span>
          </we-file-upload>

          <Show when={preview()}>
            <we-image
              src={preview()!}
              alt="Preview"
              fit="contain"
              style={{
                width: '100%',
                'max-height': '200px',
                'border-radius': 'var(--we-radius-200)',
              }}
            />
          </Show>

          {/* Actions */}
          <Row ax="end" gap="200">
            <we-button variant="ghost" onClick={closeModal}>
              Cancel
            </we-button>
            <we-button disabled={!pendingFile()} onClick={confirm}>
              Save
            </we-button>
          </Row>
        </we-modal>
      </Show>
    </>
  );
}
