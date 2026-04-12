import { createSignal, Show } from 'solid-js';

export type * from './EditableImage.types';
import type { EditableImageProps } from './EditableImage.types';

export function EditableImage(props: EditableImageProps) {
  const [modalOpen, setModalOpen] = createSignal(false);
  const [preview, setPreview] = createSignal<string | null>(null);
  const [pendingFile, setPendingFile] = createSignal<File | null>(null);
  const [dragging, setDragging] = createSignal(false);

  const width = () => props.width || '100%';
  const height = () => props.height || '200px';
  const borderRadius = () => (props.r ? `var(--we-radius-${props.r}, ${props.r})` : '0');

  function openModal() {
    setPreview(null);
    setPendingFile(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setPreview(null);
    setPendingFile(null);
  }

  function handleFileSelected(file: File) {
    if (!file.type.startsWith('image/')) return;
    setPendingFile(file);
    const url = URL.createObjectURL(file);
    setPreview(url);
  }

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleFileSelected(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileSelected(file);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave() {
    setDragging(false);
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
        style={{
          position: 'relative',
          width: width(),
          height: height(),
          'border-radius': borderRadius(),
          overflow: 'hidden',
          cursor: 'pointer',
          'background-color': 'var(--we-color-neutral-200)',
          'flex-shrink': '0',
        }}
        onClick={openModal}
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
        <div
          class="editable-image__overlay"
          style={{
            position: 'absolute',
            inset: '0',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            background: 'rgba(0, 0, 0, 0.5)',
            opacity: '0',
            transition: 'opacity 0.2s ease',
          }}
        >
          <we-icon name="pencil" size="24px" color="white" />
        </div>
      </div>

      {/* CSS for hover — injected once */}
      <style>{`
        .editable-image:hover .editable-image__overlay {
          opacity: 1 !important;
        }
      `}</style>

      {/* Upload modal */}
      <Show when={modalOpen()}>
        <we-modal close={closeModal}>
          <div
            style={{
              display: 'flex',
              'flex-direction': 'column',
              gap: 'var(--we-spacing-400)',
              padding: 'var(--we-spacing-600)',
              'min-width': '400px',
            }}
          >
            <we-text fontSize="500" fontWeight="semibold">
              {props.src ? 'Change Image' : 'Upload Image'}
            </we-text>

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              style={{
                border: `2px dashed var(--we-color-${dragging() ? 'primary-400' : 'neutral-300'})`,
                'border-radius': 'var(--we-radius-300)',
                padding: 'var(--we-spacing-600)',
                display: 'flex',
                'flex-direction': 'column',
                'align-items': 'center',
                gap: 'var(--we-spacing-300)',
                'min-height': '160px',
                'justify-content': 'center',
                background: dragging() ? 'var(--we-color-primary-50)' : 'var(--we-color-neutral-100)',
                transition: 'border-color 0.2s, background 0.2s',
              }}
            >
              <Show
                when={preview()}
                fallback={
                  <>
                    <we-icon name="upload" size="32px" color="neutral-400" />
                    <we-text fontSize="300" color="neutral-500">
                      Drag and drop an image here, or click to select
                    </we-text>
                  </>
                }
              >
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

              <input
                type="file"
                accept="image/*"
                style={{
                  position: 'absolute',
                  width: '100%',
                  height: '100%',
                  opacity: '0',
                  cursor: 'pointer',
                }}
                onChange={handleFileInput}
              />
            </div>

            {/* Actions */}
            <div
              style={{
                display: 'flex',
                gap: 'var(--we-spacing-200)',
                'justify-content': 'flex-end',
              }}
            >
              <we-button variant="ghost" onClick={closeModal}>
                Cancel
              </we-button>
              <we-button disabled={!pendingFile()} onClick={confirm}>
                Save
              </we-button>
            </div>
          </div>
        </we-modal>
      </Show>
    </>
  );
}
