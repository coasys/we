import { Column, Row } from '@we/components/solid';
import type { FileData } from '@we/models';
import { readFileAsFileData } from '@we/models';
import { createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { BlockPlaceholder } from '../BlockPlaceholder';
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
 * Modal: file upload zone + optional title/artist fields.
 * Loaded state: AudioDisplay with a delete toolbar when selected.
 */
export function AudioInput(props: AudioInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [pendingTitle, setPendingTitle] = createSignal('');
  const [pendingArtist, setPendingArtist] = createSignal('');

  // Derive a playable URL from audioUrl (handles both string data URI and FileData).
  const displayAudioUrl = () => {
    const u = props.audioUrl;
    if (!u) return undefined;
    if (typeof u === 'string') return u;
    return `data:${u.file_type};base64,${u.data_base64}`;
  };

  async function receiveFile(file: File) {
    const fileData = await readFileAsFileData(file);
    props.onChange('audioUrl', fileData);
    const autoTitle = pendingTitle().trim() || file.name.replace(/\.[^/.]+$/, '');
    props.onChange('title', autoTitle);
    if (pendingArtist().trim()) props.onChange('artist', pendingArtist().trim());
    setPendingTitle('');
    setPendingArtist('');
    setShowModal(false);
  }

  function handleModalFileChange(e: Event) {
    const file = (e as CustomEvent).detail as File | null;
    if (!file) return;
    receiveFile(file).catch(console.error);
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
            <we-button square variant="ghost" onClick={handleDelete}>
              <we-icon name="x" size="xs" />
            </we-button>
          </Row>
        </Show>
      </Show>

      {/* Add-audio modal — portalled to escape the Lexical contenteditable context. */}
      <Show when={showModal()}>
        <Portal>
          <we-modal close={() => setShowModal(false)}>
            <we-text fontWeight="bold" fontSize="600" textAlign="center">
              Add Audio
            </we-text>

            <we-file-upload accept="audio/*" on:change={handleModalFileChange} width="100%">
              <we-icon name="music-note" color="neutral-500" size="lg" />
              <we-text color="neutral-500" fontSize="400">
                Drop an audio file or click to browse
              </we-text>
            </we-file-upload>

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
          </we-modal>
        </Portal>
      </Show>
    </Column>
  );
}
