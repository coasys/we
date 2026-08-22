import { Column, EditableImage, Row } from '@we/components/solid';
import { createMemo, createSignal, For, Show } from 'solid-js';

import { useEditorHost } from '../host';
import { TemplateCard } from './TemplateCard';

const MAX_SCREENSHOTS = 4;

const slugify = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '-');

interface Props {
  type: 'template' | 'theme';
  onClose: () => void;
}

export function PublishToMarketplaceModal(props: Props) {
  const identity = useEditorHost().identity;
  const templateStore = useEditorHost().template;
  const themeStore = useEditorHost().theme;

  const isTheme = () => props.type === 'theme';

  const baseTheme = () => themeStore.editingTheme() ?? themeStore.currentTheme();

  const [name, setName] = createSignal(
    isTheme() ? (baseTheme().name ?? '') : (templateStore.currentTemplate.meta?.name ?? ''),
  );
  const [description, setDescription] = createSignal(
    isTheme() ? '' : (templateStore.currentTemplate.meta?.description ?? ''),
  );
  const [icon, setIcon] = createSignal(
    isTheme() ? (baseTheme().icon ?? 'palette') : (templateStore.currentTemplate.meta?.icon ?? 'layout'),
  );
  const [themeId, setThemeId] = createSignal('');
  const [slug, setSlug] = createSignal(
    slugify(isTheme() ? (baseTheme().slug ?? baseTheme().name ?? '') : (templateStore.currentTemplate.id ?? '')),
  );
  const [screenshots, setScreenshots] = createSignal<File[]>([]);
  const [screenshotPreviews, setScreenshotPreviews] = createSignal<string[]>([]);
  const [publishing, setPublishing] = createSignal(false);

  const themeOptions = createMemo(() => [
    { value: '', label: 'No associated theme' },
    ...themeStore.allThemes().map((t) => ({ value: t.id, label: t.name })),
  ]);

  const canPublish = createMemo(() => name().trim().length > 0 && slug().trim().length > 0);

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

  const previewData = createMemo(() =>
    isTheme()
      ? {
          name: name() || 'Theme name',
          description: description(),
          version: baseTheme().version ?? 1,
          icon: icon(),
          author: identity.me()?.did,
          screenshots: screenshotPreviews(),
        }
      : {
          name: name() || 'Template name',
          description: description(),
          version: 1,
          icon: icon(),
          slug: slug(),
          author: identity.me()?.did,
          screenshots: screenshotPreviews(),
        },
  );

  async function handlePublish() {
    if (!canPublish()) return;
    setPublishing(true);
    try {
      const success = isTheme()
        ? await themeStore.publishToMarketplace({
            name: name().trim(),
            description: description().trim(),
            icon: icon(),
            slug: slug().trim(),
            screenshots: screenshots(),
          })
        : await templateStore.publishToMarketplace({
            name: name().trim(),
            description: description().trim(),
            icon: icon(),
            themeId: themeId() || undefined,
            slug: slug().trim(),
            screenshots: screenshots(),
          });
      if (success) props.onClose();
    } finally {
      setPublishing(false);
    }
  }

  return (
    <we-modal close={props.onClose} width="100%" maxWidth="600px">
      <Column ax="center" gap="200">
        <we-icon name={isTheme() ? 'paint-bucket' : 'cloud-arrow-up'} size="xl" color="accent-text" />
        <we-text variant="heading-md">{isTheme() ? 'Publish theme to marketplace' : 'Publish to marketplace'}</we-text>
      </Column>

      <Column gap="400">
        {/* Name + Icon */}
        <Row gap="300" ay="end">
          <Column gap="100" flex="1">
            <we-text variant="label">Name</we-text>
            <we-input
              value={name()}
              placeholder={isTheme() ? 'Theme name' : 'Template name'}
              on:input={(e: CustomEvent) => setName(e.detail)}
            />
          </Column>
          <Column gap="100">
            <we-text variant="label">Icon</we-text>
            <we-icon-picker value={icon()} on:change={(e: CustomEvent) => setIcon(e.detail)} />
          </Column>
        </Row>

        {/* Slug */}
        <Column gap="100">
          <we-text variant="label">Slug</we-text>
          <we-input
            value={slug()}
            placeholder={isTheme() ? 'theme-slug' : 'template-slug'}
            on:input={(e: CustomEvent) => setSlug(slugify(e.detail))}
          />
          <we-text variant="footnote" color="text-muted">
            Unique identifier for this listing in the marketplace. Change it if you're publishing a variant that
            shouldn't overwrite an existing one.
          </we-text>
        </Column>

        {/* Description */}
        <Column gap="100">
          <we-text variant="label">Description</we-text>
          <we-textarea
            value={description()}
            placeholder={isTheme() ? 'Describe this theme…' : 'Describe what this template is for…'}
            rows={3}
            on:input={(e: CustomEvent) => setDescription(e.detail)}
          />
        </Column>

        {/* Associated theme (templates only) */}
        <Show when={!isTheme()}>
          <Column gap="100">
            <we-text variant="label">Associated theme (optional)</we-text>
            <we-select value={themeId()} options={themeOptions()} onChange={(e: CustomEvent) => setThemeId(e.detail)} />
            <we-text variant="footnote" color="text-muted">
              Link a theme so users can install it alongside this template.
            </we-text>
          </Column>
        </Show>

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
                border="1px dashed border-strong"
                bg="surface-sunken"
                placeholderIcon="image"
                aspect={3 / 2}
                onImageChange={addScreenshot}
              />
            </Show>
          </Row>
        </Column>

        {/* Card preview */}
        <Column gap="200">
          <we-text variant="label" color="text-muted">
            Preview
          </we-text>
          <TemplateCard template={previewData()} mode="preview" />
        </Column>
      </Column>

      {/* Actions */}
      <Row ax="end" gap="200" pt="400" mt="100">
        <we-button variant="ghost" onClick={props.onClose} disabled={publishing()}>
          Cancel
        </we-button>
        <we-button variant="primary" disabled={!canPublish()} loading={publishing()} onClick={handlePublish}>
          Publish
        </we-button>
      </Row>
    </we-modal>
  );
}
