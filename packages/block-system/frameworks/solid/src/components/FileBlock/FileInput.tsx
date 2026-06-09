import { Column, Row } from '@we/components/solid';
import type { FileData } from '@we/models';
import { readFileAsFileData } from '@we/models';
import { createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { BlockPlaceholder } from '../BlockPlaceholder';
import { FileDisplay } from './FileDisplay';

interface FileInputProps {
  title: string | undefined;
  name: string | undefined;
  url: string | FileData | undefined;
  mimeType: string | undefined;
  size: number | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

/**
 * Input component for FileBlock.
 * Empty state: BlockPlaceholder with file drop or click to open modal.
 * Modal: file upload zone → title field (auto-populated from filename) → Save.
 * Loaded state: FileDisplay with edit + delete toolbar when selected.
 */
export function FileInput(props: FileInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [pendingTitle, setPendingTitle] = createSignal('');
  const [pendingFile, setPendingFile] = createSignal<File | null>(null);
  const [isEditing, setIsEditing] = createSignal(false);

  // Derive a usable URL from url (handles both string data URI and FileData).
  const displayUrl = () => {
    const u = props.url;
    if (!u) return undefined;
    if (typeof u === 'string') return u;
    return `data:${u.file_type};base64,${u.data_base64}`;
  };

  function resetPending() {
    setPendingFile(null);
    setPendingTitle('');
    setIsEditing(false);
  }

  function openEditModal() {
    setPendingTitle(props.title ?? props.name ?? '');
    setIsEditing(true);
    setShowModal(true);
  }

  function closeModal() {
    resetPending();
    setShowModal(false);
  }

  async function saveFile() {
    const file = pendingFile();
    if (file) {
      const fileData = await readFileAsFileData(file);
      props.onChange('url', fileData);
      props.onChange('name', file.name);
      props.onChange('mimeType', file.type);
      props.onChange('size', file.size);
    }
    props.onChange('title', pendingTitle().trim() || pendingFile()?.name || props.name || '');
    closeModal();
  }

  // Called by the direct drop-on-placeholder path (bypasses modal entirely).
  async function receiveFile(file: File) {
    const fileData = await readFileAsFileData(file);
    props.onChange('url', fileData);
    props.onChange('name', file.name);
    props.onChange('mimeType', file.type);
    props.onChange('size', file.size);
    props.onChange('title', file.name);
  }

  function handleModalFileChange(e: Event) {
    const file = (e as CustomEvent).detail as File | null;
    if (!file) return;
    setPendingFile(file);
    if (!pendingTitle().trim()) setPendingTitle(file.name);
  }

  function handleDelete() {
    props.onChange('url', undefined);
    props.onChange('name', undefined);
    props.onChange('mimeType', undefined);
    props.onChange('size', undefined);
    props.onChange('title', undefined);
  }

  return (
    <Column position="relative">
      <Show
        when={props.url}
        fallback={
          <BlockPlaceholder
            icon="paperclip"
            label="Add a file"
            hint="Drop here or click to browse"
            onFileDrop={receiveFile}
            onClick={() => setShowModal(true)}
          />
        }
      >
        <FileDisplay
          url={displayUrl()}
          title={props.title}
          name={props.name}
          mimeType={props.mimeType}
          size={props.size}
        />
        <Show when={props.isSelected()}>
          <Row
            position="absolute"
            top="5px"
            right="5px"
            p="200"
            r="200"
            gap="200"
            border="1px solid var(--we-color-neutral-100)"
            bg="neutral-0"
          >
            <we-button square variant="ghost" onClick={openEditModal}>
              <we-icon name="pencil" size="xs" />
            </we-button>
            <we-button square variant="ghost" onClick={handleDelete}>
              <we-icon name="x" size="xs" />
            </we-button>
          </Row>
        </Show>
      </Show>

      {/* Add/edit file modal — portalled to escape the Lexical contenteditable context. */}
      <Show when={showModal()}>
        <Portal>
          <we-modal close={closeModal} ax="center" minWidth="400px">
            <we-text fontWeight="bold" fontSize="600" textAlign="center">
              {isEditing() ? 'Edit File' : 'Add File'}
            </we-text>

            <Show when={!isEditing()}>
              <we-file-upload on:change={handleModalFileChange} width="100%">
                <we-icon name="paperclip" color="neutral-500" size="lg" />
                <we-text color="neutral-500" fontSize="400">
                  {pendingFile() ? pendingFile()!.name : 'Drop a file or click to browse'}
                </we-text>
              </we-file-upload>
            </Show>

            <we-input
              type="text"
              value={pendingTitle()}
              on:input={(e: CustomEvent) => setPendingTitle(e.detail)}
              placeholder="Title (optional)"
              width="100%"
            />
            <Show when={pendingFile() || isEditing()}>
              <Row gap="200" ax="center" width="100%">
                <we-button variant="ghost" onClick={closeModal}>
                  Cancel
                </we-button>
                <we-button variant="primary" onClick={() => saveFile().catch(console.error)}>
                  Save
                </we-button>
              </Row>
            </Show>
          </we-modal>
        </Portal>
      </Show>
    </Column>
  );
}
