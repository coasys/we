import { Column, EditableImage, Row } from '@we/components/solid';
import { createMemo, createSignal, For, Show } from 'solid-js';

import { useAdamStore } from '../../stores/AdamStore';
import { useTemplateStore } from '../../stores/TemplateStore';
import { TemplateCard } from '../marketplace/TemplateCard';

const MAX_SCREENSHOTS = 4;

interface Props {
  onClose: () => void;
}

export function PublishToMarketplaceModal(props: Props) {
  const adamStore = useAdamStore();
  const templateStore = useTemplateStore();

  const initialName = templateStore.currentTemplate.meta?.name ?? '';
  const initialDescription = templateStore.currentTemplate.meta?.description ?? '';

  const [name, setName] = createSignal(initialName);
  const [description, setDescription] = createSignal(initialDescription);
  const [screenshots, setScreenshots] = createSignal<File[]>([]);
  const [screenshotPreviews, setScreenshotPreviews] = createSignal<string[]>([]);
  const [publishing, setPublishing] = createSignal(false);

  const canPublish = createMemo(() => name().trim().length > 0);

  const addScreenshot = (file: File) => {
    if (screenshots().length >= MAX_SCREENSHOTS) return;
    const url = URL.createObjectURL(file);
    setScreenshots((prev) => [...prev, file]);
    setScreenshotPreviews((prev) => [...prev, url]);
  };

  const removeScreenshot = (index: number) => {
    setScreenshots((prev) => prev.filter((_, i) => i !== index));
    setScreenshotPreviews((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  };

  const previewTemplate = createMemo(() => ({
    name: name() || 'Template name',
    description: description(),
    version: 1,
    slug: templateStore.currentTemplate.id,
    author: adamStore.me()?.did,
    screenshots: screenshotPreviews(),
  }));

  async function handlePublish() {
    if (!canPublish()) return;
    setPublishing(true);
    try {
      const success = await templateStore.publishToMarketplace({
        name: name().trim(),
        description: description().trim(),
        screenshots: screenshots(),
      });
      if (success) props.onClose();
    } finally {
      setPublishing(false);
    }
  }

  return (
    <we-modal close={props.onClose} style={{ '--we-modal-max-width': '780px' }}>
      <Column p="500" gap="500">
        <we-text variant="heading-sm">Publish to marketplace</we-text>

        <Row gap="500" ay="start">
          {/* Left: form fields */}
          <Column gap="400" flex="1" minWidth="0">
            {/* Name */}
            <Column gap="100">
              <we-text variant="label">Name</we-text>
              <we-input value={name()} placeholder="Template name" on:input={(e: CustomEvent) => setName(e.detail)} />
            </Column>

            {/* Description */}
            <Column gap="100">
              <we-text variant="label">Description</we-text>
              <we-textarea
                value={description()}
                placeholder="Describe what this template is for…"
                rows={3}
                on:input={(e: CustomEvent) => setDescription(e.detail)}
              />
            </Column>

            {/* Screenshots */}
            <Column gap="200">
              <Row ay="center" ax="between">
                <we-text variant="label">Screenshots</we-text>
                <we-text variant="footnote">
                  {screenshotPreviews().length}/{MAX_SCREENSHOTS}
                </we-text>
              </Row>
              <Row gap="200" wrap>
                <For each={screenshotPreviews()}>
                  {(src, i) => (
                    <Column position="relative" width="120px" height="80px">
                      <we-image src={src} fit="cover" r="200" width="120px" height="80px" />
                      <we-button
                        variant="danger"
                        size="xs"
                        square
                        position="absolute"
                        top="-6px"
                        right="-6px"
                        onClick={() => removeScreenshot(i())}
                      >
                        <we-icon name="x" />
                      </we-button>
                    </Column>
                  )}
                </For>
                <Show when={screenshotPreviews().length < MAX_SCREENSHOTS}>
                  <EditableImage
                    width="120px"
                    height="80px"
                    r="200"
                    border="1px dashed neutral-300"
                    bg="neutral-50"
                    placeholderIcon="image"
                    aspect={3 / 2}
                    onImageChange={addScreenshot}
                  />
                </Show>
              </Row>
            </Column>
          </Column>

          {/* Right: card preview */}
          <Column gap="200" width="260px">
            <we-text variant="label" color="neutral-500">
              Preview
            </we-text>
            <TemplateCard template={previewTemplate()} mode="preview" />
          </Column>
        </Row>

        {/* Actions */}
        <Row ax="end" gap="200" borderTop="1px solid neutral-200" pt="400" mt="100">
          <we-button variant="ghost" onClick={props.onClose} disabled={publishing()}>
            Cancel
          </we-button>
          <we-button variant="primary" disabled={!canPublish()} loading={publishing()} onClick={handlePublish}>
            Publish
          </we-button>
        </Row>
      </Column>
    </we-modal>
  );
}
