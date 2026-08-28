import { AudioVisualiser } from '@we/components/solid';
import { Column, Row } from '@we/components/solid';
import type { FileData } from '@we/models';
import { readFileAsFileData } from '@we/models';
import { createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { BlockPlaceholder } from '../BlockPlaceholder';
import { BlockToolbar } from '../BlockToolbar';
import { AudioDisplay } from './AudioDisplay';

interface AudioInputProps {
  title: string | undefined;
  artist: string | undefined;
  audioUrl: string | FileData | undefined;
  duration: number | undefined;
  albumArt: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

/**
 * Input component for AudioBlock.
 * Empty state: BlockPlaceholder with file drop (audio/*) or click to open modal.
 * Modal: file upload zone → audio preview + optional title/artist fields → Save.
 * Loaded state: AudioDisplay with a delete toolbar when selected.
 */
export function AudioInput(props: AudioInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [pendingTitle, setPendingTitle] = createSignal('');
  const [pendingArtist, setPendingArtist] = createSignal('');
  const [pendingFile, setPendingFile] = createSignal<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = createSignal<string | undefined>(undefined);
  const [isEditing, setIsEditing] = createSignal(false);

  // Derive a playable URL from audioUrl (handles both string data URI and FileData).
  const displayAudioUrl = () => {
    const u = props.audioUrl;
    if (!u) return undefined;
    if (typeof u === 'string') return u;
    return `data:${u.file_type};base64,${u.data_base64}`;
  };

  function resetPending() {
    const url = pendingPreviewUrl();
    // Only revoke object URLs — not the existing audio data URI from props.
    if (url && !isEditing()) URL.revokeObjectURL(url);
    setPendingFile(null);
    setPendingPreviewUrl(undefined);
    setPendingTitle('');
    setPendingArtist('');
    setIsEditing(false);
  }

  function openEditModal() {
    setPendingTitle(props.title ?? '');
    setPendingArtist(props.artist ?? '');
    setPendingPreviewUrl(displayAudioUrl());
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
      props.onChange('audioUrl', fileData);
      props.onChange('title', pendingTitle().trim() || file.name.replace(/\.[^/.]+$/, ''));
    } else {
      props.onChange('title', pendingTitle().trim() || props.title || '');
    }
    props.onChange('artist', pendingArtist().trim() || undefined);
    closeModal();
  }

  // Called by the direct drop-on-placeholder path (bypasses modal entirely).
  async function receiveFile(file: File) {
    const fileData = await readFileAsFileData(file);
    props.onChange('audioUrl', fileData);
    props.onChange('title', file.name.replace(/\.[^/.]+$/, ''));
  }

  function handleModalFileChange(e: Event) {
    const file = (e as CustomEvent).detail as File | null;
    if (!file) return;
    const url = pendingPreviewUrl();
    if (url) URL.revokeObjectURL(url);
    setPendingPreviewUrl(URL.createObjectURL(file));
    setPendingFile(file);
    if (!pendingTitle().trim()) setPendingTitle(file.name.replace(/\.[^/.]+$/, ''));
  }

  function handleDelete() {
    props.onChange('audioUrl', undefined);
    props.onChange('title', undefined);
    props.onChange('artist', undefined);
  }

  return (
    <Column position="relative">
      <Show
        when={props.audioUrl}
        fallback={
          <BlockPlaceholder
            icon="music-note"
            label="Add audio"
            hint="Drop here or click to browse"
            accept="audio/*"
            onFileDrop={receiveFile}
            onClick={() => setShowModal(true)}
          />
        }
      >
        <AudioDisplay
          title={props.title}
          artist={props.artist}
          audioUrl={displayAudioUrl()}
          duration={props.duration}
          albumArt={props.albumArt}
        />
        <Show when={props.isSelected()}>
          <BlockToolbar>
            <we-button square variant="ghost" onClick={openEditModal}>
              <we-icon name="pencil" size="xs" />
            </we-button>
            <we-button square variant="ghost" onClick={handleDelete}>
              <we-icon name="x" size="xs" />
            </we-button>
          </BlockToolbar>
        </Show>
      </Show>

      {/* Add-audio modal — portalled to escape the editor's contenteditable context. */}
      <Show when={showModal()}>
        <Portal>
          <we-modal close={closeModal} size="sm">
            <we-text variant="heading-md">Add Audio</we-text>

            <Show
              when={pendingPreviewUrl()}
              fallback={
                <we-file-upload accept="audio/*" on:change={handleModalFileChange} width="100%">
                  <we-icon name="music-note" color="text-muted" size="lg" />
                  <we-text color="text-muted" fontSize="400">
                    Drop an audio file or click to browse
                  </we-text>
                </we-file-upload>
              }
            >
              <AudioVisualiser src={pendingPreviewUrl()} />
              <we-button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const url = pendingPreviewUrl();
                  if (url) URL.revokeObjectURL(url);
                  setPendingPreviewUrl(undefined);
                  setPendingFile(null);
                }}
              >
                <we-icon name="trash" size="xs" />
                Remove file
              </we-button>
            </Show>

            <we-input
              type="text"
              value={pendingTitle()}
              on:input={(e: CustomEvent) => setPendingTitle(e.detail)}
              placeholder="Track title (optional)"
              width="100%"
            />
            <we-input
              type="text"
              value={pendingArtist()}
              on:input={(e: CustomEvent) => setPendingArtist(e.detail)}
              placeholder="Artist (optional)"
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
