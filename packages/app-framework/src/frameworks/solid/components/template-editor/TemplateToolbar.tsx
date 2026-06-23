import { Column, Row, SearchInput } from '@we/components/solid';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import { useAdamStore } from '../../stores/AdamStore';
import { useAiStore } from '../../stores/AiStore';
import { useSpaceStore } from '../../stores/SpaceStore';
import { useTemplateStore } from '../../stores/TemplateStore';
import { panelResizing, TOTAL_RAIL_WIDTH } from './RightPanelContainer';

export function TemplateToolbar() {
  const templateStore = useTemplateStore();
  const spaceStore = useSpaceStore();
  const aiStore = useAiStore();
  const adamStore = useAdamStore();

  // Template switcher dropdown
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  let containerRef: HTMLDivElement | undefined;

  // Picker local state
  const [pickerName, setPickerName] = createSignal('');
  const [pickerIcon, setPickerIcon] = createSignal('cube');
  const [pickerDestination, setPickerDestination] = createSignal<'personal' | 'space'>('personal');
  const [pickerSaving, setPickerSaving] = createSignal(false);

  // Share dropdown state
  const [shareOpen, setShareOpen] = createSignal(false);
  const [shareView, setShareView] = createSignal<'main' | 'space'>('main');
  const [spaceSearch, setSpaceSearch] = createSignal('');
  // Tracks which destination is loading: 'marketplace' | space uuid | null
  const [shareLoading, setShareLoading] = createSignal<string | null>(null);

  // When picker opens, seed fields from store defaults and close the switcher
  createEffect(() => {
    if (aiStore.pickerOpen()) {
      setPickerName(aiStore.pickerDefaultName());
      setPickerIcon(aiStore.pickerDefaultIcon());
      setPickerDestination('personal');
      setOpen(false);
      setSearch('');
    }
  });

  const closeSwitcher = () => {
    setOpen(false);
    setSearch('');
  };

  const closeShare = () => {
    setShareOpen(false);
    setShareView('main');
    setSpaceSearch('');
  };

  const toggleSwitcher = () => {
    if (open()) {
      closeSwitcher();
    } else {
      if (aiStore.pickerOpen()) aiStore.cancelPicker();
      closeShare();
      setOpen(true);
    }
  };

  const toggleShare = () => {
    if (shareOpen()) {
      closeShare();
    } else {
      if (open()) closeSwitcher();
      if (aiStore.pickerOpen()) aiStore.cancelPicker();
      setShareOpen(true);
    }
  };

  // Close switcher, picker, or share when clicking outside the chip
  createEffect(() => {
    if (!open() && !aiStore.pickerOpen() && !shareOpen()) return;
    const onOutside = (e: MouseEvent) => {
      if (!containerRef?.contains(e.target as Node)) {
        if (open()) closeSwitcher();
        if (aiStore.pickerOpen()) aiStore.cancelPicker();
        if (shareOpen()) closeShare();
      }
    };
    document.addEventListener('mousedown', onOutside);
    onCleanup(() => document.removeEventListener('mousedown', onOutside));
  });

  const filteredGroups = createMemo(() => {
    const q = search().toLowerCase();
    return templateStore
      .switcherGroups()
      .map((group) => ({
        ...group,
        items: q ? group.items.filter((item) => item.name.toLowerCase().includes(q)) : group.items,
      }))
      .filter((group) => group.items.length > 0);
  });

  const filteredSpaces = createMemo(() => {
    const q = spaceSearch().toLowerCase();
    const items = adamStore.orderedSidebarItems();
    return q ? items.filter((s) => s.name.toLowerCase().includes(q)) : items;
  });

  // Can the user directly edit this template (i.e. it's not read-only/core)?
  const canEdit = () => !aiStore.isReadOnly();

  // Icon representing the currently active edit action
  const editActionIcon = () => {
    if (aiStore.editAction() === 'fork') return 'git-fork';
    if (aiStore.editAction() === 'fresh') return 'file-plus';
    return 'pencil-simple';
  };

  // Keep the toolbar clear of the right panel area (rail + any open panels)
  const rowRight = () => {
    let offset = 10;
    if (aiStore.isEditMode()) {
      offset += TOTAL_RAIL_WIDTH;
      if (aiStore.isOpen()) offset += aiStore.aiPanelWidth();
      if (aiStore.codePanelOpen()) offset += aiStore.codePanelWidth();
    }
    return `${offset}px`;
  };

  async function handlePickerConfirm() {
    const name = pickerName().trim();
    if (!name) return;
    setPickerSaving(true);
    try {
      await aiStore.confirmPicker(name, pickerIcon() || 'cube', pickerDestination());
    } finally {
      setPickerSaving(false);
    }
  }

  function handleExportJson() {
    const json = aiStore.schemaJson();
    const name = aiStore.templateName();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    closeShare();
  }

  async function handleShareToSpace(uuid: string, spaceName: string) {
    setShareLoading(uuid);
    try {
      const success = await templateStore.publishToSpace(uuid, spaceName);
      if (success) closeShare();
    } finally {
      setShareLoading(null);
    }
  }

  async function handlePublishToMarketplace() {
    setShareLoading('marketplace');
    try {
      const success = await templateStore.publishToMarketplace();
      if (success) closeShare();
    } finally {
      setShareLoading(null);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: '0', 'pointer-events': 'none', 'z-index': '10' }}>
      {/* Outer row: edit toolbar (left, edit mode only) + chip (right, always) */}
      <Row
        ref={containerRef}
        position="absolute"
        top="10px"
        styles={{ right: rowRight(), transition: panelResizing() ? 'none' : 'right 300ms ease' }}
        pointerEvents="auto"
        ay="start"
        gap="200"
      >
        {/* ── Edit-mode toolbar ── */}
        <Show when={aiStore.isEditMode()}>
          <Column position="relative">
            <Row ay="center" gap="100" bg="neutral-50" border="1px solid neutral-200" r="400" p="200">
              {/* View mode buttons */}
              <we-tooltip title="Preview" placement="bottom">
                <we-button
                  variant={aiStore.contentMode() === 'preview' ? 'secondary' : 'ghost'}
                  square
                  onClick={() => aiStore.setContentMode('preview')}
                >
                  <we-icon name="eye" />
                </we-button>
              </we-tooltip>
              <we-tooltip title="Visual editor" placement="bottom">
                <we-button
                  variant={aiStore.contentMode() === 'visual' ? 'secondary' : 'ghost'}
                  square
                  onClick={() => aiStore.setContentMode('visual')}
                >
                  <we-icon name="pencil-ruler" />
                </we-button>
              </we-tooltip>

              <we-divider orientation="vertical" color="neutral-200" height="28px" />

              {/* Undo / Redo */}
              <we-tooltip title="Undo" placement="bottom">
                <we-button variant="ghost" square disabled={!aiStore.canUndo()} onClick={() => aiStore.undo()}>
                  <we-icon name="arrow-u-up-left" />
                </we-button>
              </we-tooltip>
              <we-tooltip title="Redo" placement="bottom">
                <we-button variant="ghost" square disabled={!aiStore.canRedo()} onClick={() => aiStore.redo()}>
                  <we-icon name="arrow-u-up-right" />
                </we-button>
              </we-tooltip>

              <we-divider orientation="vertical" color="neutral-200" height="28px" />

              {/* Share */}
              <we-button variant={shareOpen() ? 'secondary' : 'ghost'} p="200" onClick={toggleShare}>
                <we-icon name="share-network" />
                <we-text>Share</we-text>
              </we-button>
            </Row>

            {/* Share dropdown */}
            <Show when={shareOpen()}>
              <Column
                position="absolute"
                top="100%"
                right="0"
                mt="100"
                bg="neutral-0"
                border="1px solid neutral-200"
                r="400"
                shadow="md"
                overflow="hidden"
                minWidth="240px"
              >
                {/* Main view */}
                <Show when={shareView() === 'main'}>
                  <Column py="200">
                    {/* Export JSON */}
                    <Row
                      ay="center"
                      gap="400"
                      px="300"
                      py="200"
                      cursor="pointer"
                      hoverProps={{ bg: 'neutral-100' }}
                      onClick={handleExportJson}
                    >
                      <we-icon name="download-simple" color="neutral-600" />
                      <Column>
                        <we-text color="neutral-800">Export as JSON</we-text>
                        <we-text fontSize="300" color="neutral-500">
                          Download template file
                        </we-text>
                      </Column>
                    </Row>

                    {/* Upload to marketplace */}
                    <Row
                      ay="center"
                      gap="400"
                      px="300"
                      py="200"
                      cursor={adamStore.marketplaceJoined() ? 'pointer' : 'not-allowed'}
                      opacity={adamStore.marketplaceJoined() ? 1 : 0.4}
                      hoverProps={adamStore.marketplaceJoined() ? { bg: 'neutral-100' } : undefined}
                      onClick={adamStore.marketplaceJoined() ? handlePublishToMarketplace : undefined}
                    >
                      <we-icon name="storefront" color="neutral-600" />
                      <Column gap="0">
                        <we-text color="neutral-800">Upload to marketplace</we-text>
                        <we-text fontSize="300" color="neutral-500">
                          {adamStore.marketplaceJoined()
                            ? 'Publish for others to install'
                            : 'Marketplace not connected'}
                        </we-text>
                      </Column>
                      <Show when={shareLoading() === 'marketplace'}>
                        <we-spinner size="sm" />
                      </Show>
                    </Row>

                    {/* Share to a space */}
                    <Row
                      ay="center"
                      gap="400"
                      px="300"
                      py="200"
                      cursor="pointer"
                      hoverProps={{ bg: 'neutral-100' }}
                      onClick={() => setShareView('space')}
                    >
                      <we-icon name="users" color="neutral-600" />
                      <Column gap="0" flex="1">
                        <we-text color="neutral-800">Share to a space</we-text>
                        <we-text fontSize="300" color="neutral-500">
                          Copy to a space's templates
                        </we-text>
                      </Column>
                      <we-icon name="caret-right" color="neutral-400" size="sm" />
                    </Row>
                  </Column>
                </Show>

                {/* Space picker sub-view */}
                <Show when={shareView() === 'space'}>
                  <Column>
                    <Row ay="center" gap="200" px="200" pt="200">
                      <we-button variant="ghost" square size="sm" onClick={() => setShareView('main')}>
                        <we-icon name="arrow-left" />
                      </we-button>
                      <we-text fontWeight="600" color="neutral-800">
                        Choose a space
                      </we-text>
                    </Row>
                    <SearchInput value={spaceSearch()} placeholder="Search spaces…" m="200" onSearch={setSpaceSearch} />
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
                              hoverProps={{ bg: 'neutral-100' }}
                              onClick={() => handleShareToSpace(space.uuid, space.name)}
                            >
                              <we-avatar image={space.avatar} initials={space.name} size="sm" />
                              <we-text color="neutral-700" flex="1">
                                {space.name}
                              </we-text>
                              <Show when={shareLoading() === space.uuid}>
                                <we-spinner size="sm" />
                              </Show>
                            </Row>
                          )}
                        </For>
                        <Show when={filteredSpaces().length === 0}>
                          <we-text variant="footnote" color="neutral-400" px="300" py="200">
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
        </Show>

        {/* ── Template switcher chip ── */}
        <Column>
          <Row ay="center" gap="100" bg="neutral-50" border="1px solid neutral-200" r="400" p="200">
            {/* Template dropdown trigger */}
            <we-tooltip title="Select a template" placement="bottom">
              <we-button variant="ghost" onClick={toggleSwitcher} p="200">
                <we-icon name={aiStore.templateIcon()} />
                <we-text>{aiStore.templateName()}</we-text>
                <we-icon name={open() ? 'caret-up' : 'caret-down'} color="neutral-500" />
              </we-button>
            </we-tooltip>

            <we-divider orientation="vertical" color="neutral-200" height="28px" />

            {/* Browse mode: Edit (if owner) + Fork + Start Fresh */}
            <Show when={!aiStore.isEditMode()}>
              <Show when={canEdit()}>
                <we-tooltip title="Edit template" placement="bottom">
                  <we-button variant="ghost" square onClick={() => aiStore.enterEditMode('edit')}>
                    <we-icon name="pencil-simple" />
                  </we-button>
                </we-tooltip>
              </Show>
              <we-tooltip title="Fork template" placement="bottom">
                <we-button variant="ghost" square onClick={() => aiStore.startFork()}>
                  <we-icon name="git-fork" />
                </we-button>
              </we-tooltip>
              <we-tooltip title="New template" placement="bottom">
                <we-button variant="ghost" square onClick={() => aiStore.startFresh()}>
                  <we-icon name="file-plus" />
                </we-button>
              </we-tooltip>
            </Show>

            {/* Edit mode: active action icon (highlighted) + close */}
            <Show when={aiStore.isEditMode()}>
              <we-button variant="secondary" square>
                <we-icon name={editActionIcon()} />
              </we-button>
              <we-tooltip title="Exit edit mode" placement="bottom">
                <we-button variant="ghost" square onClick={() => aiStore.exitEditMode()}>
                  <we-icon name="x" />
                </we-button>
              </we-tooltip>
            </Show>
          </Row>

          {/* Template switcher dropdown */}
          <Show when={open()}>
            <Column
              position="absolute"
              top="100%"
              right="0"
              mt="100"
              bg="neutral-0"
              border="1px solid neutral-200"
              r="400"
              shadow="md"
              overflow="hidden"
              minWidth="300px"
            >
              <SearchInput value={search()} placeholder="Search templates…" m="200" onSearch={setSearch} />
              <we-divider />
              <we-scroll-area maxHeight="320px">
                <Column py="200">
                  <For each={filteredGroups()}>
                    {(group) => (
                      <Column>
                        <we-text variant="footnote" color="neutral-400" px="300" pt="300" pb="100">
                          {group.label}
                        </we-text>
                        <For each={group.items}>
                          {(template) => {
                            const isCurrent = createMemo(() => template.id === templateStore.currentTemplate.id);
                            const isDefault = createMemo(
                              () =>
                                !!spaceStore.spaceDefaultTemplateId() &&
                                template.id === spaceStore.spaceDefaultTemplateId(),
                            );
                            return (
                              <Row
                                ay="center"
                                gap="200"
                                px="300"
                                py="200"
                                cursor="pointer"
                                bg={isCurrent() ? 'primary-100' : 'neutral-0'}
                                hoverProps={{ bg: 'neutral-100' }}
                                onClick={() => {
                                  templateStore.switchTemplate(template.id);
                                  closeSwitcher();
                                }}
                              >
                                <we-icon name={template.icon} size="sm" color="neutral-600" />
                                <we-text color="neutral-700" flex="1">
                                  {template.name}
                                </we-text>
                                <Show when={isDefault()}>
                                  <we-icon name="star" weight="fill" color="warning-500" size="sm" />
                                </Show>
                              </Row>
                            );
                          }}
                        </For>
                      </Column>
                    )}
                  </For>
                </Column>
              </we-scroll-area>
            </Column>
          </Show>

          {/* Name + icon picker dropdown (fork / start fresh) */}
          <Show when={aiStore.pickerOpen()}>
            <Column
              position="absolute"
              top="100%"
              right="0"
              mt="100"
              bg="neutral-0"
              border="1px solid neutral-200"
              r="400"
              shadow="md"
              p="400"
              gap="300"
              minWidth="280px"
            >
              <we-text fontSize="400" fontWeight="600" color="neutral-800">
                {aiStore.pickerAction() === 'fresh' ? 'Create New Template' : 'Name Your Fork'}
              </we-text>

              <Column gap="100">
                <we-text fontSize="200" fontWeight="600" color="neutral-600">
                  Name
                </we-text>
                <we-input
                  value={pickerName()}
                  placeholder="My Template"
                  size="sm"
                  on:input={(e: CustomEvent) => setPickerName(e.detail)}
                  on:keydown={(e: CustomEvent) => {
                    if (e.detail.key === 'Enter') handlePickerConfirm();
                    if (e.detail.key === 'Escape') aiStore.cancelPicker();
                  }}
                />
              </Column>

              <Column gap="100">
                <we-text fontSize="200" fontWeight="600" color="neutral-600">
                  Icon
                </we-text>
                <we-icon-picker
                  value={pickerIcon()}
                  size="sm"
                  on:change={(e: CustomEvent) => setPickerIcon(e.detail)}
                />
              </Column>

              <Show when={aiStore.pickerShowDestination()}>
                <Column gap="100">
                  <we-text fontSize="200" fontWeight="600" color="neutral-600">
                    Save to
                  </we-text>
                  <Row gap="200">
                    <we-button
                      size="sm"
                      variant={pickerDestination() === 'personal' ? 'secondary' : 'ghost'}
                      onClick={() => setPickerDestination('personal')}
                    >
                      My templates
                    </we-button>
                    <we-button
                      size="sm"
                      variant={pickerDestination() === 'space' ? 'secondary' : 'ghost'}
                      onClick={() => setPickerDestination('space')}
                    >
                      This space
                    </we-button>
                  </Row>
                </Column>
              </Show>

              <Row ax="end" gap="200">
                <we-button size="sm" variant="ghost" onClick={() => aiStore.cancelPicker()} disabled={pickerSaving()}>
                  Cancel
                </we-button>
                <we-button
                  size="sm"
                  disabled={!pickerName().trim()}
                  loading={pickerSaving()}
                  onClick={handlePickerConfirm}
                >
                  {pickerSaving() ? 'Saving...' : aiStore.pickerAction() === 'fresh' ? 'Create' : 'Fork'}
                </we-button>
              </Row>
            </Column>
          </Show>
        </Column>
      </Row>
    </div>
  );
}
