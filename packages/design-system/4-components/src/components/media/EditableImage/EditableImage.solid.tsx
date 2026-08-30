import { designSystemKeys, filterProps, mergeProps } from '@we/design-utils';
import { buildLayoutStyles, getBgImageAttrs, useStateProps } from '@we/design-utils/solid';
import { createMemo, createSignal, onCleanup, Show, splitProps } from 'solid-js';

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
const componentKeys = [
  'src',
  'alt',
  'fit',
  'placeholderIcon',
  'onImageChange',
  'onImageRemove',
  'uploadLabel',
  'editLabel',
  'class',
  'aspect',
  'maxSize',
] as const;

/** @superclass DesignSystemElement */
export function EditableImage(allProps: EditableImageProps) {
  const [dsProps, props] = splitProps(
    allProps,
    editableImageKeys as unknown as (keyof EditableImageProps)[],
    componentKeys as unknown as (keyof EditableImageProps)[],
  );
  const [modalOpen, setModalOpen] = createSignal(false);
  const [rawUrl, setRawUrl] = createSignal<string | null>(null);
  const [pendingFile, setPendingFile] = createSignal<File | null>(null);
  const [dragging, setDragging] = createSignal(false);

  /** What the hover overlay says, and what its icon promises. */
  const label = () => (props.src ? (props.editLabel ?? 'Edit image') : (props.uploadLabel ?? 'Upload image'));

  /*
    A wide crop zone needs a wide sheet, so the aspect picks the modal's size.

    This was a `minWidth` on the Column *inside* the modal, solving for a pixel figure between 520
    and 1100 — which worked only because the modal had no width of its own and grew to whatever it
    was given. Pushing a sheet wider from the inside has no answer for the viewport: at aspect 3 on
    a laptop it computed 1100px and simply overflowed. Asking for a size instead means the modal
    clamps to the screen the way every other modal does.
  */
  const modalSize = () => ((props.aspect ?? 1) > 1.5 ? 'lg' : 'md');

  // Imperative handle to ImageCrop — set once the crop component reports ready
  let cropRef: ImageCropRef | undefined;
  let fileInput: HTMLInputElement | undefined;

  const baseStyle = createMemo(() => {
    const usedProps = filterProps(dsProps, editableImageStyleKeys);
    const merged = mergeProps(usedProps, DEFAULTS) as EditableImageProps;
    return { ...buildLayoutStyles(merged, 'column'), 'flex-shrink': '0' };
  });

  // Tiers count as much as states: both route through the same var indirection, and gating on the
  // states alone would leave `mdUpProps` here typechecking and doing nothing.
  const hasVariantProps = () =>
    dsProps.hoverProps ||
    dsProps.activeProps ||
    dsProps.focusProps ||
    dsProps.smUpProps ||
    dsProps.mdUpProps ||
    dsProps.lgUpProps;
  const { style, attrs, checkSurface } = useStateProps(baseStyle, dsProps as EditableImageProps, 'column');

  /**
   * Straight to the OS file picker. Clicking used to open a modal whose only content was a
   * dropzone, so reaching the filesystem took two clicks — and the dropzone was unreachable by
   * dragging, since you had to click to make it exist. The click is a user gesture, so calling
   * .click() on the input inside it is permitted.
   */
  function pickFile() {
    fileInput?.click();
  }

  /** A file has arrived, from the picker or a drop. Skip the upload step; go and crop it. */
  function acceptFile(file: File | null | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    const old = rawUrl();
    if (old) URL.revokeObjectURL(old);
    cropRef = undefined;
    setPendingFile(file);
    setRawUrl(URL.createObjectURL(file));
    setModalOpen(true);
  }

  function handleInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    acceptFile(input.files?.[0]);
    // Cleared so choosing the same file twice in a row still fires a change event.
    input.value = '';
  }

  /*
    The object URL goes with the component, not only with the modal.

    Every path that *closes* the crop step revoked it, and unmounting is not one of them: navigating
    away, switching the record being edited, or a route change with the crop modal open left the
    blob alive for the life of the page. An image is megabytes, and the whole point of an object URL
    is that the browser cannot tell when you are done with it.
  */
  onCleanup(() => {
    const url = rawUrl();
    if (url) URL.revokeObjectURL(url);
  });

  function closeModal() {
    setModalOpen(false);
    const url = rawUrl();
    if (url) URL.revokeObjectURL(url);
    setRawUrl(null);
    setPendingFile(null);
    cropRef = undefined;
  }

  /** Back to the picker without leaving the crop step — the modal restages on the new file. */
  function changePhoto() {
    pickFile();
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

  function removeImage(e: MouseEvent) {
    // Without this the click reaches the tile beneath and opens the picker on the way out.
    e.stopPropagation();
    props.onImageRemove?.();
  }

  return (
    <>
      {/*
        role/tabIndex/keydown rather than wrapping this in a `we-button`. The button sizes to its
        content and its [part=base] is `all: unset`, so making it a fixed-height container for an
        inset overlay means fighting its layout model. The semantics a real button would bring are
        restored explicitly instead — before this the tile was a bare div and could not be reached
        by keyboard at all.
      */}
      <div
        class={`editable-image ${dragging() ? 'editable-image--dragging' : ''} ${props.class || ''}`}
        style={hasVariantProps() ? style() : baseStyle()}
        ref={checkSurface}
        role="button"
        tabIndex={0}
        /*
          A tab stop, but not the one a dialog should open on. Pressing Enter here opens the OS file
          picker, and the tile is often the first thing in a form (a cover image above the name
          field), so an overlay taking the first focusable landed every keyboard user in a file
          dialog over the form they came to fill in. See `skipsInitialFocus` in overlay-element.
        */
        data-we-skip-autofocus=""
        aria-label={label()}
        onClick={pickFile}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          // Space would otherwise scroll the page out from under the dialog about to open.
          e.preventDefault();
          pickFile();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          acceptFile(e.dataTransfer?.files?.[0]);
        }}
        {...getBgImageAttrs(dsProps)}
        {...(hasVariantProps() ? attrs : {})}
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          onChange={handleInputChange}
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
        />

        <Show
          when={props.src}
          fallback={
            <Column width="100%" height="100%" ax="center" ay="center">
              <we-icon name={props.placeholderIcon || 'image'} size="32px" color="text-faint" />
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
          {/* A pencil over an empty tile promises editing something that does not exist yet. */}
          <we-icon name={props.src ? 'pencil' : 'upload-simple'} size="24px" color="#fff" />
          {/*
            No `fontSize` here on purpose. Unset, the custom property resolves to `inherit` for an
            inherited property, so the label takes its size from this component's own `fontSize` DS
            prop — a small tile can shrink the label without the component growing an API for it.

            `textAlign` because the label wraps on a narrow tile, and a wrapped line was left-
            aligned inside a centred box, which reads as a misalignment rather than as wrapping.
          */}
          <we-text color="#fff" textAlign="center">
            {label()}
          </we-text>
        </Column>

        {/*
          A sibling of the tile, not a child of anything clickable — a button inside a button is
          invalid and breaks tab order. Only offered when the caller can actually honour it.
        */}
        <Show when={props.src && props.onImageRemove}>
          <we-button
            class="editable-image__remove"
            variant="secondary"
            size="sm"
            square
            position="absolute"
            top="200"
            right="200"
            zIndex={1}
            title="Remove image"
            aria-label="Remove image"
            onClick={removeImage}
          >
            <we-icon name="x" />
          </we-button>
        </Show>
      </div>

      {/* Crop — the only step left in the modal. */}
      <Show when={modalOpen()}>
        <we-modal close={closeModal} size={modalSize()}>
          <Column width="100%" ax="center" gap="500">
            <we-text variant="heading-md">Crop image</we-text>
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
          </Column>
        </we-modal>
      </Show>
    </>
  );
}
