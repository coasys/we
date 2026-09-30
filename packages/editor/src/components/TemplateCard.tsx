import { Card, Column, ImageLightbox, Row } from '@we/components/solid';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';

import type { EditorAgentProfile as AgentProfileSummary } from '../host';
import { useEditorHost } from '../host';

export interface TemplateCardData {
  id?: string;
  name: string;
  description?: string;
  version: number;
  slug?: string;
  author?: string;
  createdAt?: string;
  screenshots?: string[]; // resolved data URIs (from ImageBlock.src via fileToDataUri)
  /** Icon name to show in the card header. Defaults to "layout". Themes pass their own icon. */
  icon?: string;
}

interface Props {
  template: TemplateCardData;
  mode?: 'marketplace' | 'compact' | 'preview';
  /** Show "Installed" badge instead of the install button. Accepts boolean or count (from $count). */
  installed?: boolean | number;
  /** Override the default installFromMarketplace action. */
  onInstall?: () => void;
  /** Label for the install button. Defaults to "Install". */
  installLabel?: string;
  /** Override the default deleteMarketplaceTemplate action. */
  onDelete?: () => void;
  /** Override the internal install-loading check. Pass a reactive boolean for schema contexts. */
  isLoading?: boolean;
}

export function TemplateCard(props: Props) {
  const identity = useEditorHost().identity;
  const templateStore = useEditorHost().template;
  const mode = () => props.mode ?? 'marketplace';

  onMount(() => {
    if (props.template.author) identity.fetchAgent(props.template.author);
  });

  const author = createMemo<AgentProfileSummary | undefined>(() =>
    identity.agents().find((a) => a.did === props.template.author),
  );

  const authorName = createMemo(() => {
    const a = author();
    if (!a) return '';
    return [a.firstName, a.lastName].filter(Boolean).join(' ');
  });

  const isOwnTemplate = createMemo(() => props.template.author === identity.me()?.did);

  const installedVersion = createMemo(() =>
    typeof props.installed === 'number' ? props.installed : props.installed ? 1 : 0,
  );
  const isInstalled = createMemo(() => installedVersion() > 0);
  const hasUpdate = createMemo(() => isInstalled() && installedVersion() < (props.template.version ?? 1));

  const installLoading = createMemo(() => {
    if (props.isLoading !== undefined) return props.isLoading;
    const id = props.template.id;
    return !!id && templateStore.operationLoading() === `marketplace-install:${id}`;
  });

  const handleInstall = () => {
    if (props.onInstall) {
      props.onInstall();
    } else if (props.template.id) {
      templateStore.installFromMarketplace(props.template.id);
    }
  };

  // In schema context, include: { screenshots: true } hydrates ImageBlock instances at runtime
  // despite the static type being string[]. In preview context they're plain data URI strings.
  const screenshots = createMemo(() =>
    (props.template.screenshots ?? []).map((item) =>
      typeof item === 'string' ? item : (item as unknown as { src: string }).src,
    ),
  );

  const [lightboxIndex, setLightboxIndex] = createSignal<number | null>(null);

  // ── Compact (list-row) mode ──────────────────────────────────────────────
  if (mode() === 'compact') {
    return (
      <Row ay="center" ax="between" p="400" r="300" border="1px solid border" bg="surface" gap="300">
        <Row ay="center" gap="400" flex="1" minWidth="0">
          <we-icon name={props.template.icon ?? 'layout'} color="accent" />
          <Column gap="100" flex="1" minWidth="0">
            <Row gap="300" ay="center">
              <we-text fontWeight="600" truncate>
                {props.template.name}
              </we-text>
              <we-badge variant="neutral" size="xs">
                v{props.template.version}
              </we-badge>
            </Row>
            <Show when={author()}>
              <Row ay="center" gap="200">
                <we-avatar size="xs" image={author()?.avatar} initials={authorName()} />
                <we-text fontSize="300" color="text-muted" truncate>
                  {authorName()}
                </we-text>
                <Show when={props.template.createdAt}>
                  <we-timestamp value={props.template.createdAt} relative color="text-faint" fontSize="300" />
                </Show>
              </Row>
            </Show>
          </Column>
        </Row>
        <Show
          when={isInstalled()}
          fallback={
            <we-button variant="primary" size="sm" loading={installLoading()} onClick={handleInstall}>
              {props.installLabel ?? 'Install'}
            </we-button>
          }
        >
          <Show
            when={hasUpdate()}
            fallback={
              <we-badge variant="success" size="sm">
                Installed
              </we-badge>
            }
          >
            <we-button variant="secondary" size="sm" loading={installLoading()} onClick={handleInstall}>
              Update
            </we-button>
          </Show>
        </Show>
      </Row>
    );
  }

  // ── Grid card mode (marketplace + preview) ───────────────────────────────
  return (
    <Card
      bg="surface-sunken"
      border="1px solid border"
      transition="box-shadow 150ms ease"
      hoverProps={mode() === 'marketplace' ? { border: '1px solid accent', shadow: 'sm' } : undefined}
    >
      {/* Header */}
      <Row ay="center" ax="between">
        <Row gap="300" ay="center" flex="1" minWidth="0">
          <we-icon name={props.template.icon ?? 'layout'} size="md" color="accent" />
          <we-text fontWeight="600" truncate>
            {props.template.name}
          </we-text>
        </Row>
        <Show when={mode() === 'marketplace' && isOwnTemplate() && !!props.template.id}>
          <we-button
            variant="ghost"
            size="sm"
            square
            onClick={() =>
              props.onDelete ? props.onDelete!() : templateStore.deleteMarketplaceTemplate(props.template.id!)
            }
          >
            <we-icon name="trash" />
          </we-button>
        </Show>
      </Row>

      {/* Description */}
      <Show when={props.template.description}>
        <we-text fontSize="300" color="text-muted">
          {props.template.description}
        </we-text>
      </Show>

      {/* Version + slug */}
      <Row gap="200" ay="center">
        <we-badge variant="neutral" size="xs" px="200">
          v{props.template.version}
        </we-badge>
        <Show when={props.template.slug}>
          <we-text fontSize="300" color="text-faint" truncate>
            {props.template.slug}
          </we-text>
        </Show>
      </Row>

      {/* Screenshots strip */}
      <Show when={screenshots().length > 0}>
        <Row gap="200" overflow="hidden" r="200" height="120px">
          <For each={screenshots().slice(0, 3)}>
            {(src, i) => (
              <we-image
                src={src}
                fit="cover"
                r="200"
                flex="1"
                minWidth="0"
                height="120px"
                cursor="pointer"
                onClick={() => setLightboxIndex(i())}
              />
            )}
          </For>
        </Row>
        <Show when={lightboxIndex() !== null}>
          <ImageLightbox srcs={screenshots()} initialIndex={lightboxIndex()!} onClose={() => setLightboxIndex(null)} />
        </Show>
      </Show>

      {/* Footer */}
      <Row ax="between" ay="center">
        <Row ay="center" gap="200" flex="1" minWidth="0">
          <Show when={author()}>
            <we-avatar size="xs" image={author()?.avatar} initials={authorName()} />
            <we-text fontSize="300" color="text-muted" truncate>
              {authorName()}
            </we-text>
          </Show>
          <Show when={props.template.createdAt}>
            <we-timestamp value={props.template.createdAt} relative color="text-faint" fontSize="300" />
          </Show>
        </Row>
        <Show when={mode() === 'marketplace'}>
          <Show
            when={isInstalled()}
            fallback={
              <we-button variant="primary" size="sm" loading={installLoading()} onClick={handleInstall}>
                {props.installLabel ?? 'Install'}
              </we-button>
            }
          >
            <Show
              when={hasUpdate()}
              fallback={
                <we-badge variant="success" size="sm">
                  Installed
                </we-badge>
              }
            >
              <we-button variant="secondary" size="sm" loading={installLoading()} onClick={handleInstall}>
                Update
              </we-button>
            </Show>
          </Show>
        </Show>
      </Row>
    </Card>
  );
}
