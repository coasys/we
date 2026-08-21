import { Column, Row, Search } from '@we/components/solid';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { useEditorHost } from '../host';
import { PublishToMarketplaceModal } from './PublishToMarketplaceModal';

/**
 * The controls that belong to a live editing session: history, mode, sharing, and the way out.
 *
 * ## Why this is still code when the pickers are not
 *
 * The two halves of the old design toolbar had different lifetimes and different owners. *Which*
 * template you are looking at is an occasional choice and a property of the shell — it moved into
 * the chrome rail as schema, where a chrome template can fork it (`DesignControls.schema.ts`).
 * These are modal: they exist only while editing, they must stay on screen throughout, and they act
 * on the session rather than on a choice.
 *
 * They also have to keep working for an application that is not WE. `mountTemplateEditor` hands an
 * embedding host the editing surface through {@link EditorHost} precisely so it never reaches WE's
 * stores — and a schema needs the app-shell store bag and the renderer, neither of which an
 * embedding host has. Porting these too would have quietly emptied that API.
 *
 * ## Position
 *
 * Beside the panels, not over them, and moved by whatever has taken the right edge — which is one
 * number from the shell now that the editor's panels are docks like every other. It used to be summed
 * from the editor's own widths *and* the shell's, and the two disagreeing is what put this toolbar on
 * top of the panel it is meant to sit beside.
 */
export function EditingBar() {
  const { session, template: templateStore, theme: themeStore, identity } = useEditorHost();

  let containerRef: HTMLDivElement | undefined;

  const [templateShareOpen, setTemplateShareOpen] = createSignal(false);
  const [themeShareOpen, setThemeShareOpen] = createSignal(false);
  const [shareView, setShareView] = createSignal<'main' | 'space'>('main');
  const [spaceSearch, setSpaceSearch] = createSignal('');
  const [shareLoading, setShareLoading] = createSignal<string | null>(null);
  const [publishModal, setPublishModal] = createSignal<'template' | 'theme' | null>(null);

  function closeDropdowns() {
    setTemplateShareOpen(false);
    setThemeShareOpen(false);
    setShareView('main');
    setSpaceSearch('');
  }

  const toggleShare = (which: 'template' | 'theme') => {
    const was = which === 'template' ? templateShareOpen() : themeShareOpen();
    closeDropdowns();
    if (!was) (which === 'template' ? setTemplateShareOpen : setThemeShareOpen)(true);
  };

  // Close on a click that is not in here. Mousedown rather than click, so a press that begins
  // outside cannot land on a control that is about to disappear from under it.
  const anyOpen = () => templateShareOpen() || themeShareOpen();
  const onDocumentMouseDown = (event: MouseEvent) => {
    if (!containerRef?.contains(event.target as Node)) closeDropdowns();
  };
  document.addEventListener('mousedown', onDocumentMouseDown);
  onCleanup(() => document.removeEventListener('mousedown', onDocumentMouseDown));

  const filteredSpaces = createMemo(() => {
    const query = spaceSearch().toLowerCase();
    const items = identity.orderedSidebarItems();
    return query ? items.filter((space) => space.name.toLowerCase().includes(query)) : items;
  });

  /**
   * Clear of everything else holding this edge: a docked module panel, the editor's own panels, and
   * the host's chrome rail.
   *
   * The rail arrives as a variable rather than a constant because it belongs to a package this one
   * cannot import, and it defaults to `0px` — an editor embedded in somebody else's application has
   * no WE rail to avoid. Without the term, the bar sits underneath the rail, which paints above it.
   *
   * The editor's own panels used to be a third term, summed from their widths. They are docks now, so
   * they are already inside `--we-dock-right` — and any panel dragged somewhere other than the right
   * edge stops pushing this bar at all, which is right and was impossible to express before.
   */
  const right = () => `calc(10px + var(--we-dock-right, 0px) + var(--we-chrome-rail-width, 0px))`;

  function exportJson() {
    const blob = new Blob([session.schemaJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${session.templateName().toLowerCase().replace(/\s+/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    closeDropdowns();
  }

  async function shareToSpace(uuid: string, name: string) {
    setShareLoading(uuid);
    try {
      const publish = templateShareOpen() ? templateStore.publishToSpace : themeStore.publishToSpace;
      if (await publish(uuid, name)) closeDropdowns();
    } finally {
      setShareLoading(null);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: '0', 'pointer-events': 'none', 'z-index': '10' }}>
      <Show when={session.isEditingTemplate() || session.isEditingTheme()}>
        <Row
          ref={containerRef}
          position="absolute"
          top="10px"
          right={right()}
          // `--we-chrome-transition` collapses to 0s while any panel is being dragged, editor panels
          // included now that they are docks. Without it this animates its `right` over 300ms on every
          // frame of a drag and trails the edge it is supposed to sit beside.
          transition="right var(--we-chrome-transition, 300ms) ease"
          pointerEvents="auto"
          ay="start"
          gap="200"
        >
          {/* History */}
          <Row
            ay="center"
            gap="100"
            bg="surfaceRaised"
            border="1px solid border"
            r="var(--we-theme-control-radius, var(--we-radius-400))"
            p="200"
          >
            <we-tooltip title="Undo" placement="bottom">
              <we-button variant="ghost" square disabled={!session.canUndo()} onClick={() => void session.undo()}>
                <we-icon name="arrow-u-up-left" />
              </we-button>
            </we-tooltip>
            <we-tooltip title="Redo" placement="bottom">
              <we-button variant="ghost" square disabled={!session.canRedo()} onClick={() => void session.redo()}>
                <we-icon name="arrow-u-up-right" />
              </we-button>
            </we-tooltip>
          </Row>

          {/* Mode — template editing only; a theme has nothing to inspect */}
          <Show when={session.isEditingTemplate()}>
            <Row
              ay="center"
              gap="100"
              bg="surfaceRaised"
              border="1px solid border"
              r="var(--we-theme-control-radius, var(--we-radius-400))"
              p="200"
            >
              <we-tooltip title="Preview" placement="bottom">
                <we-button
                  variant={session.contentMode() === 'preview' ? 'secondary' : 'ghost'}
                  square
                  onClick={() => session.setContentMode('preview')}
                >
                  <we-icon name="eye" />
                </we-button>
              </we-tooltip>
              <we-tooltip title="Visual editor" placement="bottom">
                <we-button
                  variant={session.contentMode() === 'visual' ? 'secondary' : 'ghost'}
                  square
                  onClick={() => session.setContentMode('visual')}
                >
                  <we-icon name="pencil-ruler" />
                </we-button>
              </we-tooltip>
            </Row>
          </Show>

          {/*
            The panels, opened and closed from here.

            This is the half of the old rails that was not resizing: each panel had a 32px strip of
            icon at its left edge which toggled it on a press and resized it on a drag. Resizing is the
            dock frame's now, on every edge and corner rather than one — and a toggle that lived on the
            panel's own edge could only be found once the panel was already there, which is a poor
            place for the control that opens it. They sit with the other things you do to a session.
          */}
          <Row
            ay="center"
            gap="100"
            bg="surfaceRaised"
            border="1px solid border"
            r="var(--we-theme-control-radius, var(--we-radius-400))"
            p="200"
          >
            <Show when={session.isEditingTemplate()}>
              <Show when={session.contentMode() === 'visual'}>
                <we-tooltip title="Properties" placement="bottom">
                  <we-button
                    variant={session.visualPanelOpen() ? 'secondary' : 'ghost'}
                    square
                    onClick={() => session.toggleVisualPanel()}
                  >
                    <we-icon name="cursor-click" />
                  </we-button>
                </we-tooltip>
              </Show>
              <we-tooltip title="Code editor" placement="bottom">
                <we-button
                  variant={session.codePanelOpen() ? 'secondary' : 'ghost'}
                  square
                  onClick={() => session.toggleCodePanel()}
                >
                  <we-icon name="code" />
                </we-button>
              </we-tooltip>
              <we-tooltip title="AI chat" placement="bottom">
                <we-button variant={session.isOpen() ? 'secondary' : 'ghost'} square onClick={() => session.toggle()}>
                  <we-icon name="chat-circle" />
                </we-button>
              </we-tooltip>
            </Show>
            <Show when={session.isEditingTheme()}>
              <we-tooltip title="Theme editor" placement="bottom">
                <we-button
                  variant={session.themePanelOpen() ? 'secondary' : 'ghost'}
                  square
                  onClick={() => session.toggleThemePanel()}
                >
                  <we-icon name="paint-bucket" />
                </we-button>
              </we-tooltip>
            </Show>
          </Row>

          {/* Share + exit — the same pair for whichever kind of session is open */}
          <Column position="relative">
            <Row
              ay="center"
              gap="100"
              bg="surfaceRaised"
              border="1px solid border"
              r="var(--we-theme-control-radius, var(--we-radius-400))"
              p="200"
            >
              <we-tooltip title="Share" placement="bottom">
                <we-button
                  variant={anyOpen() ? 'secondary' : 'ghost'}
                  square
                  onClick={() => toggleShare(session.isEditingTemplate() ? 'template' : 'theme')}
                >
                  <we-icon name="share-network" />
                </we-button>
              </we-tooltip>
              <we-tooltip title="Finish editing" placement="bottom">
                <we-button
                  variant="ghost"
                  square
                  onClick={() =>
                    session.isEditingTemplate() ? session.exitTemplateEditing() : session.exitThemeEditing()
                  }
                >
                  <we-icon name="x" />
                </we-button>
              </we-tooltip>
            </Row>

            <Show when={anyOpen()}>
              <Column
                position="absolute"
                top="100%"
                right="0"
                mt="100"
                bg="surface"
                border="1px solid border"
                r="var(--we-theme-surface-radius, var(--we-radius-400))"
                shadow="md"
                overflow="hidden"
                minWidth="260px"
              >
                <Show when={shareView() === 'main'}>
                  <Column py="200">
                    {/* Export is a template-only idea — a theme is not a schema you can download */}
                    <Show when={templateShareOpen()}>
                      <Row
                        ay="center"
                        gap="400"
                        px="300"
                        py="200"
                        cursor="pointer"
                        hoverProps={{ bg: 'surfaceSunken' }}
                        onClick={exportJson}
                      >
                        <we-icon name="download-simple" color="textMuted" />
                        <Column gap="0">
                          <we-text color="text">Export as JSON</we-text>
                          <we-text variant="footnote" color="textMuted">
                            Download template file
                          </we-text>
                        </Column>
                      </Row>
                    </Show>
                    <Row
                      ay="center"
                      gap="400"
                      px="300"
                      py="200"
                      cursor={identity.marketplaceJoined() ? 'pointer' : 'not-allowed'}
                      opacity={identity.marketplaceJoined() ? 1 : 0.4}
                      hoverProps={identity.marketplaceJoined() ? { bg: 'surfaceSunken' } : undefined}
                      onClick={
                        identity.marketplaceJoined()
                          ? () => {
                              const kind = templateShareOpen() ? 'template' : 'theme';
                              closeDropdowns();
                              setPublishModal(kind);
                            }
                          : undefined
                      }
                    >
                      <we-icon name="storefront" color="textMuted" />
                      <Column gap="0">
                        <we-text color="text">Upload to marketplace</we-text>
                        <we-text variant="footnote" color="textMuted">
                          {identity.marketplaceJoined() ? 'Publish for others to install' : 'Marketplace not connected'}
                        </we-text>
                      </Column>
                    </Row>
                    <Row
                      ay="center"
                      gap="400"
                      px="300"
                      py="200"
                      cursor="pointer"
                      hoverProps={{ bg: 'surfaceSunken' }}
                      onClick={() => setShareView('space')}
                    >
                      <we-icon name="users" color="textMuted" />
                      <Column gap="0" flex="1">
                        <we-text color="text">Share to a space</we-text>
                        <we-text variant="footnote" color="textMuted">
                          Copy it into a space's library
                        </we-text>
                      </Column>
                      <we-icon name="caret-right" color="textFaint" size="sm" />
                    </Row>
                  </Column>
                </Show>

                <Show when={shareView() === 'space'}>
                  <Column>
                    <Row ay="center" gap="200" px="200" pt="200">
                      <we-button variant="ghost" square size="sm" onClick={() => setShareView('main')}>
                        <we-icon name="arrow-left" />
                      </we-button>
                      <we-text fontWeight="600" color="text">
                        Choose a space
                      </we-text>
                    </Row>
                    <Search value={spaceSearch()} placeholder="Search spaces…" m="200" onSearch={setSpaceSearch} />
                    <we-divider />
                    <we-scroll-area maxHeight="280px">
                      <Column py="200">
                        <For each={filteredSpaces()}>
                          {(space) => (
                            <Row
                              ay="center"
                              gap="200"
                              px="300"
                              py="200"
                              cursor="pointer"
                              hoverProps={{ bg: 'surfaceSunken' }}
                              onClick={() => void shareToSpace(space.uuid, space.name)}
                            >
                              <we-avatar image={space.avatar} initials={space.name} size="sm" />
                              <we-text color="text" flex="1">
                                {space.name}
                              </we-text>
                              <Show when={shareLoading() === space.uuid}>
                                <we-spinner size="sm" />
                              </Show>
                            </Row>
                          )}
                        </For>
                        <Show when={filteredSpaces().length === 0}>
                          <we-text variant="footnote" color="textFaint" px="300" py="200">
                            No spaces found
                          </we-text>
                        </Show>
                      </Column>
                    </we-scroll-area>
                  </Column>
                </Show>
              </Column>
            </Show>
          </Column>
        </Row>
      </Show>

      <Show when={publishModal()}>
        {(kind) => (
          <Portal>
            <PublishToMarketplaceModal type={kind()} onClose={() => setPublishModal(null)} />
          </Portal>
        )}
      </Show>
    </div>
  );
}
