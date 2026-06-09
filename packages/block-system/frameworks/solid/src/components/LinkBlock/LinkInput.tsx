import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { BlockPlaceholder } from '../BlockPlaceholder';
import { LinkDisplay } from './LinkDisplay';

interface LinkInputProps {
  url: string | undefined;
  title: string | undefined;
  description: string | undefined;
  thumbnail: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

export function LinkInput(props: LinkInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [url, setUrl] = createSignal('');
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');

  function openModal() {
    setUrl(props.url || '');
    setTitle(props.title || '');
    setDescription(props.description || '');
    setShowModal(true);
  }

  function handleSubmit() {
    if (url().trim()) {
      props.onChange('url', url().trim());
      if (title().trim()) props.onChange('title', title().trim());
      if (description().trim()) props.onChange('description', description().trim());
      setShowModal(false);
    }
  }

  function handleDelete() {
    props.onChange('url', undefined);
    props.onChange('title', undefined);
    props.onChange('description', undefined);
    props.onChange('thumbnail', undefined);
  }

  return (
    <Column position="relative">
      <Show
        when={props.url}
        fallback={<BlockPlaceholder icon="link" label="Add a link" hint="Click to enter a URL" onClick={openModal} />}
      >
        <LinkDisplay url={props.url} title={props.title} description={props.description} thumbnail={props.thumbnail} />

        {/* Selection toolbar */}
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
            <we-button square variant="ghost" onClick={openModal}>
              <we-icon name="pencil-simple" size="xs" />
            </we-button>
            <we-button square variant="ghost" onClick={handleDelete}>
              <we-icon name="x" size="xs" />
            </we-button>
          </Row>
        </Show>
      </Show>

      {/* Add/edit modal — portalled to escape the Lexical contenteditable context. */}
      <Show when={showModal()}>
        <Portal>
          <we-modal close={() => setShowModal(false)} ax="center" minWidth="400px">
            <we-text fontWeight="bold" fontSize="600" textAlign="center">
              {props.url ? 'Edit Link' : 'Add Link'}
            </we-text>

            <Column width="100%" gap="400">
              <we-input
                type="text"
                value={url()}
                on:input={(e: CustomEvent) => setUrl(e.detail)}
                placeholder="https://example.com"
              />
              <we-input
                type="text"
                value={title()}
                on:input={(e: CustomEvent) => setTitle(e.detail)}
                placeholder="Title (optional)"
              />
              <we-input
                type="text"
                value={description()}
                on:input={(e: CustomEvent) => setDescription(e.detail)}
                placeholder="Description (optional)"
              />
            </Column>

            <Row ax="center" gap="300">
              <we-button variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </we-button>
              <we-button variant="primary" onClick={handleSubmit} disabled={!url().trim()}>
                {props.url ? 'Save' : 'Add'}
              </we-button>
            </Row>
          </we-modal>
        </Portal>
      </Show>
    </Column>
  );
}
