import { Column, Row, Search } from '@we/components/solid';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import { Portal } from 'solid-js/web';

import { useAdamStore } from '../../stores/AdamStore';
import { useAiStore } from '../../stores/AiStore';
import { useSpaceStore } from '../../stores/SpaceStore';
import { useTemplateStore } from '../../stores/TemplateStore';
import { useThemeStore } from '../../stores/ThemeStore';
import { PublishToMarketplaceModal } from './PublishToMarketplaceModal';
import { panelResizing, RAIL_STRIP_WIDTH, TEMPLATE_RAILS_WIDTH, THEME_RAIL_WIDTH } from './RightPanelContainer';

export function DesignToolbar() {
  const templateStore = useTemplateStore();
  const spaceStore = useSpaceStore();
  const aiStore = useAiStore();
  const adamStore = useAdamStore();
  const themeStore = useThemeStore();

  let containerRef: HTMLDivElement | undefined;

  // ── Template switcher ──
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');

  // ── Template edit dropdown (pencil menu, inactive state) ──
  const [templateEditOpen, setTemplateEditOpen] = createSignal(false);

  // ── Template share dropdown (active editing state) ──
  const [templateShareOpen, setTemplateShareOpen] = createSignal(false);
  const [shareView, setShareView] = createSignal<'main' | 'space'>('main');
  const [spaceSearch, setSpaceSearch] = createSignal('');
  const [shareLoading, setShareLoading] = createSignal<string | null>(null);

  // ── Theme picker ──
  const [themeOpen, setThemeOpen] = createSignal(false);
  const [themeSearch, setThemeSearch] = createSignal('');

  // ── Theme edit dropdown (pencil menu, inactive state) ──
  const [themeEditOpen, setThemeEditOpen] = createSignal(false);

  // ── Theme share dropdown (active editing state) ──
  const [themeShareOpen, setThemeShareOpen] = createSignal(false);
  const [themeShareView, setThemeShareView] = createSignal<'main' | 'space'>('main');
  const [themeShareLoading, setThemeShareLoading] = createSignal<string | null>(null);

  // ── Theme picker (fork / new) ──
  const [themePickerOpen, setThemePickerOpen] = createSignal(false);
  const [themePickerAction, setThemePickerAction] = createSignal<'fork' | 'fresh'>('fork');
  const [themePickerName, setThemePickerName] = createSignal('');
  const [themePickerIcon, setThemePickerIcon] = createSignal('paint-bucket');
  const [themePickerDestination, setThemePickerDestination] = createSignal<'personal' | 'space'>('personal');
  const [themePickerSaving, setThemePickerSaving] = createSignal(false);

  // ── Modals ──
  const [publishModalOpen, setPublishModalOpen] = createSignal(false);
  const [publishThemeModalOpen, setPublishThemeModalOpen] = createSignal(false);

  // ── Picker (fork / start fresh) ──
  const [pickerName, setPickerName] = createSignal('');
  const [pickerIcon, setPickerIcon] = createSignal('cube');
  const [pickerDestination, setPickerDestination] = createSignal<'personal' | 'space'>('personal');
  const [pickerSaving, setPickerSaving] = createSignal(false);

  // ── Close everything ──
  function closeAllDropdowns() {
    setOpen(false);
    setSearch('');
    setTemplateEditOpen(false);
    setTemplateShareOpen(false);
    setShareView('main');
    setSpaceSearch('');
    setThemeOpen(false);
    setThemeSearch('');
    setThemeEditOpen(false);
    setThemeShareOpen(false);
    setThemeShareView('main');
    setThemePickerOpen(false);
    if (aiStore.pickerOpen()) aiStore.cancelPicker();
  }

  // ── Toggle helpers — close others, then open target ──
  const toggleSwitcher = () => {
    const was = open();
    closeAllDropdowns();
    if (!was) setOpen(true);
  };
  const toggleTemplateEditDropdown = () => {
    const was = templateEditOpen();
    closeAllDropdowns();
    if (!was) setTemplateEditOpen(true);
  };
  const toggleTemplateShareDropdown = () => {
    const was = templateShareOpen();
    closeAllDropdowns();
    if (!was) setTemplateShareOpen(true);
  };
  const toggleThemePicker = () => {
    const was = themeOpen();
    closeAllDropdowns();
    if (!was) setThemeOpen(true);
  };
  const toggleThemeEditDropdown = () => {
    const was = themeEditOpen();
    closeAllDropdowns();
    if (!was) setThemeEditOpen(true);
  };
  const toggleThemeShareDropdown = () => {
    const was = themeShareOpen();
    closeAllDropdowns();
    if (!was) setThemeShareOpen(true);
  };

  // Exit theme editing when the active theme changes to a different theme.
  // Untrack the guard so entering edit mode doesn't re-trigger this.
  // We do NOT exit when currentThemeId changes to the editing theme's own id,
  // which happens during saveEditingTheme after the theme is persisted.
  createEffect(() => {
    const newId = themeStore.currentThemeId();
    if (untrack(() => aiStore.isEditingTheme())) {
      const editingId = untrack(() => themeStore.editingTheme()?.id);
      if (newId !== editingId) aiStore.exitThemeEditing();
    }
  });

  // Seed picker fields when it opens
  createEffect(() => {
    if (aiStore.pickerOpen()) {
      setPickerName(aiStore.pickerDefaultName());
      setPickerIcon(aiStore.pickerDefaultIcon());
      setPickerDestination('personal');
    }
  });

  // Keyboard shortcuts for undo/redo while editing
  createEffect(() => {
    if (!aiStore.isEditingTemplate() && !aiStore.isEditingTheme()) return;
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key !== 'z' && e.key !== 'Z') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) {
        if (aiStore.canRedo()) aiStore.redo();
      } else {
        if (aiStore.canUndo()) aiStore.undo();
      }
    };
    document.addEventListener('keydown', handler);
    onCleanup(() => document.removeEventListener('keydown', handler));
  });

  // Close all when clicking outside the chip container
  const anyOpen = () =>
    open() ||
    aiStore.pickerOpen() ||
    templateEditOpen() ||
    templateShareOpen() ||
    themeOpen() ||
    themeEditOpen() ||
    themeShareOpen() ||
    themePickerOpen();

  createEffect(() => {
    if (!anyOpen()) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef?.contains(e.target as Node)) closeAllDropdowns();
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  // ── Derived data ──
  const filteredGroups = createMemo(() => {
    const q = search().toLowerCase();
    return templateStore
      .switcherGroups()
      .map((g) => ({
        ...g,
        items: q ? g.items.filter((item) => item.name.toLowerCase().includes(q)) : g.items,
      }))
      .filter((g) => g.items.length > 0);
  });

  const filteredSpaces = createMemo(() => {
    const q = spaceSearch().toLowerCase();
    const items = adamStore.orderedSidebarItems();
    return q ? items.filter((s) => s.name.toLowerCase().includes(q)) : items;
  });

  const filteredBuiltInThemes = createMemo(() => {
    const q = themeSearch().toLowerCase();
    return q ? themeStore.builtInThemes().filter((t) => t.name.toLowerCase().includes(q)) : themeStore.builtInThemes();
  });

  const filteredInstalledThemes = createMemo(() => {
    const q = themeSearch().toLowerCase();
    return q
      ? themeStore.installedThemes().filter((t) => t.name.toLowerCase().includes(q))
      : themeStore.installedThemes();
  });

  const filteredSpaceThemes = createMemo(() => {
    const q = themeSearch().toLowerCase();
    return q ? themeStore.spaceThemes().filter((t) => t.name.toLowerCase().includes(q)) : themeStore.spaceThemes();
  });

  const canEdit = () => !aiStore.isReadOnly();

  // Toolbar right offset — accounts for whichever rails/panels are visible
  const rowRight = () => {
    let offset = 10;
    if (aiStore.isEditingTheme()) {
      offset += THEME_RAIL_WIDTH;
      if (aiStore.themePanelOpen()) offset += aiStore.themePanelWidth();
    }
    if (aiStore.isEditingTemplate()) {
      offset += TEMPLATE_RAILS_WIDTH;
      if (aiStore.codePanelOpen()) offset += aiStore.codePanelWidth();
      if (aiStore.isOpen()) offset += aiStore.aiPanelWidth();
      if (aiStore.contentMode() === 'visual') {
        offset += RAIL_STRIP_WIDTH;
        if (aiStore.visualPanelOpen()) offset += aiStore.visualPanelWidth();
      }
    }
    return `${offset}px`;
  };

  // ── Action handlers ──
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
    closeAllDropdowns();
  }

  async function handleShareToSpace(uuid: string, spaceName: string) {
    setShareLoading(uuid);
    try {
      const success = await templateStore.publishToSpace(uuid, spaceName);
      if (success) closeAllDropdowns();
    } finally {
      setShareLoading(null);
    }
  }

  async function handleShareThemeToSpace(uuid: string, spaceName: string) {
    setThemeShareLoading(uuid);
    try {
      const success = await themeStore.publishToSpace(uuid, spaceName);
      if (success) closeAllDropdowns();
    } finally {
      setThemeShareLoading(null);
    }
  }

  function handlePublishTemplateToMarketplace() {
    closeAllDropdowns();
    setPublishModalOpen(true);
  }

  async function handleThemePickerConfirm() {
    const name = themePickerName().trim();
    if (!name) return;
    setThemePickerSaving(true);
    try {
      const sourceId = themePickerAction() === 'fork' ? themeStore.currentThemeId() : undefined;
      const ok = await themeStore.createAndStartEditing(
        name,
        themePickerIcon() || 'paint-bucket',
        sourceId,
        themePickerDestination(),
      );
      if (ok) {
        setThemePickerOpen(false);
        aiStore.enterThemeEditing();
      }
    } finally {
      setThemePickerSaving(false);
    }
  }

  function handlePublishThemeToMarketplace() {
    closeAllDropdowns();
    setPublishThemeModalOpen(true);
  }

  return (
    <div style={{ position: 'fixed', inset: '0', 'pointer-events': 'none', 'z-index': '10' }}>
      <Row
        ref={containerRef}
        position="absolute"
        top="10px"
        styles={{ right: rowRight(), transition: panelResizing() ? 'none' : 'right 300ms ease' }}
        pointerEvents="auto"
        ay="start"
        gap="200"
      >
        {/* ── Undo/redo chip (visible whenever template or theme editing is active) ── */}
        <Show when={aiStore.isEditingTemplate() || aiStore.isEditingTheme()}>
          <Row
            ay="center"
            gap="100"
            bg="neutral-50"
            border="1px solid neutral-200"
            r="var(--we-theme-control-radius, var(--we-radius-400))"
            p="200"
          >
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
          </Row>
        </Show>

        {/* ── Mode chip (visible when editing a template) ── */}
        <Show when={aiStore.isEditingTemplate()}>
          <Row
            ay="center"
            gap="100"
            bg="neutral-50"
            border="1px solid neutral-200"
            r="var(--we-theme-control-radius, var(--we-radius-400))"
            p="200"
          >
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
          </Row>
        </Show>

        {/* ── Theme chip ── */}
        <Column position="relative">
          <Row
            ay="center"
            gap="100"
            bg="neutral-50"
            border="1px solid neutral-200"
            r="var(--we-theme-control-radius, var(--we-radius-400))"
            p="200"
          >
            {/* Theme selector */}
            <we-tooltip title="Select a theme" placement="bottom">
              <we-button variant={themeOpen() ? 'secondary' : 'ghost'} onClick={toggleThemePicker} p="200">
                <we-icon name={themeStore.currentTheme().icon || 'paint-bucket'} />
                <we-text>{themeStore.currentTheme().name}</we-text>
                <we-icon name={themeOpen() ? 'caret-up' : 'caret-down'} color="neutral-500" />
              </we-button>
            </we-tooltip>

            <we-divider orientation="vertical" color="neutral-200" height="28px" />

            {/* Globe/globe-x — toggles whether the space theme applies globally or only to the template */}
            <we-tooltip
              title={themeStore.themeScope() === 'global' ? 'Apply theme to space only' : 'Apply theme globally'}
              placement="bottom"
            >
              <we-button variant="ghost" square onClick={() => themeStore.toggleThemeScope()}>
                <we-icon name={themeStore.themeScope() === 'global' ? 'globe' : 'globe-x'} />
              </we-button>
            </we-tooltip>

            {/* Inactive: pencil opens edit dropdown */}
            <Show when={!aiStore.isEditingTheme()}>
              <we-tooltip title="Edit theme" placement="bottom">
                <we-button variant={themeEditOpen() ? 'secondary' : 'ghost'} square onClick={toggleThemeEditDropdown}>
                  <we-icon name="pencil-simple" />
                </we-button>
              </we-tooltip>
            </Show>

            {/* Active: share + ✕ */}
            <Show when={aiStore.isEditingTheme()}>
              <we-tooltip title="Share" placement="bottom">
                <we-button variant={themeShareOpen() ? 'secondary' : 'ghost'} square onClick={toggleThemeShareDropdown}>
                  <we-icon name="share-network" />
                </we-button>
              </we-tooltip>
              <we-tooltip title="Exit theme editing" placement="bottom">
                <we-button variant="ghost" square onClick={() => aiStore.exitThemeEditing()}>
                  <we-icon name="x" />
                </we-button>
              </we-tooltip>
            </Show>
          </Row>

          {/* Theme picker dropdown */}
          <Show when={themeOpen()}>
            <Column
              position="absolute"
              top="100%"
              right="0"
              mt="100"
              bg="neutral-0"
              border="1px solid neutral-200"
              r="var(--we-theme-surface-radius, var(--we-radius-400))"
              shadow="md"
              minWidth="220px"
            >
              <Search value={themeSearch()} placeholder="Search themes…" m="200" onSearch={setThemeSearch} />
              <we-divider />
              <Column py="200" maxHeight="320px" overflowY="auto">
                <Show when={filteredSpaceThemes().length > 0}>
                  <we-text variant="footnote" color="neutral-400" px="300" pt="300" pb="100">
                    Space themes
                  </we-text>
                  <For each={filteredSpaceThemes()}>
                    {(theme) => {
                      const isDefault = createMemo(
                        () => !!spaceStore.spaceDefaultThemeId() && theme.id === spaceStore.spaceDefaultThemeId(),
                      );
                      return (
                        <Row
                          ay="center"
                          gap="200"
                          px="300"
                          py="200"
                          cursor="pointer"
                          bg={theme.id === themeStore.currentThemeId() ? 'primary-100' : 'neutral-0'}
                          hoverProps={{ bg: 'neutral-100' }}
                          onClick={() => {
                            themeStore.setCurrentTheme(theme.id);
                            closeAllDropdowns();
                          }}
                        >
                          <we-icon name={theme.icon || 'paint-bucket'} size="sm" color="neutral-600" />
                          <we-text color="neutral-700" flex="1">
                            {theme.name}
                          </we-text>
                          <Show when={isDefault()}>
                            <we-icon name="star" weight="fill" color="warning-500" size="sm" />
                          </Show>
                        </Row>
                      );
                    }}
                  </For>
                </Show>
                <Show when={filteredInstalledThemes().length > 0}>
                  <we-text variant="footnote" color="neutral-400" px="300" pt="300" pb="100">
                    My themes
                  </we-text>
                  <For each={filteredInstalledThemes()}>
                    {(theme) => {
                      const isDefault = createMemo(
                        () => !!spaceStore.spaceDefaultThemeId() && theme.id === spaceStore.spaceDefaultThemeId(),
                      );
                      return (
                        <Row
                          ay="center"
                          gap="200"
                          px="300"
                          py="200"
                          cursor="pointer"
                          bg={theme.id === themeStore.currentThemeId() ? 'primary-100' : 'neutral-0'}
                          hoverProps={{ bg: 'neutral-100' }}
                          onClick={() => {
                            themeStore.setCurrentTheme(theme.id);
                            closeAllDropdowns();
                          }}
                        >
                          <we-icon name={theme.icon || 'paint-bucket'} size="sm" color="neutral-600" />
                          <we-text color="neutral-700" flex="1">
                            {theme.name}
                          </we-text>
                          <Show when={isDefault()}>
                            <we-icon name="star" weight="fill" color="warning-500" size="sm" />
                          </Show>
                        </Row>
                      );
                    }}
                  </For>
                </Show>
                <we-text variant="footnote" color="neutral-400" px="300" pt="300" pb="100">
                  Built-in
                </we-text>
                <For each={filteredBuiltInThemes()}>
                  {(theme) => {
                    const isDefault = createMemo(
                      () => !!spaceStore.spaceDefaultThemeId() && theme.id === spaceStore.spaceDefaultThemeId(),
                    );
                    return (
                      <Row
                        ay="center"
                        gap="200"
                        px="300"
                        py="200"
                        cursor="pointer"
                        bg={theme.id === themeStore.currentThemeId() ? 'primary-100' : 'neutral-0'}
                        hoverProps={{ bg: 'neutral-100' }}
                        onClick={() => {
                          themeStore.setCurrentTheme(theme.id);
                          closeAllDropdowns();
                        }}
                      >
                        <we-icon name={theme.icon} size="sm" color="neutral-600" />
                        <we-text color="neutral-700" flex="1">
                          {theme.name}
                        </we-text>
                        <Show when={isDefault()}>
                          <we-icon name="star" weight="fill" color="warning-500" size="sm" />
                        </Show>
                      </Row>
                    );
                  }}
                </For>
              </Column>
            </Column>
          </Show>

          {/* Theme edit dropdown (pencil menu) */}
          <Show when={themeEditOpen()}>
            <Column
              position="absolute"
              top="100%"
              right="0"
              mt="100"
              bg="neutral-0"
              border="1px solid neutral-200"
              r="var(--we-theme-surface-radius, var(--we-radius-400))"
              shadow="md"
              overflow="hidden"
              minWidth="330px"
            >
              <Column py="200">
                <Show when={themeStore.currentTheme().origin !== 'built-in'}>
                  <Row
                    ay="center"
                    gap="400"
                    px="300"
                    py="200"
                    cursor="pointer"
                    hoverProps={{ bg: 'neutral-100' }}
                    onClick={() => {
                      themeStore.startEditing(themeStore.currentThemeId());
                      aiStore.enterThemeEditing();
                      closeAllDropdowns();
                    }}
                  >
                    <we-icon name="pencil-simple" color="neutral-600" size="sm" />
                    <Column>
                      <we-text color="neutral-800">Edit</we-text>
                      <we-text fontSize="200" color="neutral-500">
                        Modify this theme
                      </we-text>
                    </Column>
                  </Row>
                </Show>
                <Row
                  ay="center"
                  gap="400"
                  px="300"
                  py="200"
                  cursor="pointer"
                  hoverProps={{ bg: 'neutral-100' }}
                  onClick={() => {
                    const current = themeStore.currentTheme();
                    setThemePickerAction('fork');
                    setThemePickerName(`${current.name} (copy)`);
                    setThemePickerIcon(current.icon || 'paint-bucket');
                    setThemePickerDestination('personal');
                    closeAllDropdowns();
                    setThemePickerOpen(true);
                  }}
                >
                  <we-icon name="git-fork" color="neutral-600" size="sm" />
                  <Column>
                    <we-text color="neutral-800">Fork</we-text>
                    <we-text fontSize="200" color="neutral-500">
                      Start a new theme based on this one
                    </we-text>
                  </Column>
                </Row>
                <Row
                  ay="center"
                  gap="400"
                  px="300"
                  py="200"
                  cursor="pointer"
                  hoverProps={{ bg: 'neutral-100' }}
                  onClick={() => {
                    setThemePickerAction('fresh');
                    setThemePickerName('');
                    setThemePickerIcon('paint-bucket');
                    setThemePickerDestination('personal');
                    closeAllDropdowns();
                    setThemePickerOpen(true);
                  }}
                >
                  <we-icon name="plus" color="neutral-600" size="sm" />
                  <Column>
                    <we-text color="neutral-800">New</we-text>
                    <we-text fontSize="200" color="neutral-500">
                      Create a new theme from scratch
                    </we-text>
                  </Column>
                </Row>
              </Column>
            </Column>
          </Show>

          {/* Theme picker (fork / new) */}
          <Show when={themePickerOpen()}>
            <Column
              position="absolute"
              top="100%"
              right="0"
              mt="100"
              bg="neutral-0"
              border="1px solid neutral-200"
              r="var(--we-theme-surface-radius, var(--we-radius-400))"
              shadow="md"
              p="400"
              gap="300"
              minWidth="280px"
            >
              <we-text fontSize="400" fontWeight="600" color="neutral-800">
                {themePickerAction() === 'fresh' ? 'New Theme' : 'Fork Theme'}
              </we-text>

              <Column gap="100">
                <we-text fontSize="200" fontWeight="600" color="neutral-600">
                  Name
                </we-text>
                <we-input
                  value={themePickerName()}
                  placeholder="My Theme"
                  size="sm"
                  on:input={(e: CustomEvent) => setThemePickerName(e.detail)}
                  on:keydown={(e: CustomEvent) => {
                    if (e.detail.key === 'Enter') handleThemePickerConfirm();
                    if (e.detail.key === 'Escape') setThemePickerOpen(false);
                  }}
                />
              </Column>

              <Column gap="100">
                <we-text fontSize="200" fontWeight="600" color="neutral-600">
                  Icon
                </we-text>
                <we-icon-picker
                  value={themePickerIcon()}
                  size="sm"
                  on:change={(e: CustomEvent) => setThemePickerIcon(e.detail)}
                />
              </Column>

              <Column gap="100">
                <we-text fontSize="200" fontWeight="600" color="neutral-600">
                  Save to
                </we-text>
                <Row gap="200">
                  <we-button
                    size="sm"
                    variant={themePickerDestination() === 'personal' ? 'secondary' : 'ghost'}
                    onClick={() => setThemePickerDestination('personal')}
                  >
                    My themes
                  </we-button>
                  <we-button
                    size="sm"
                    variant={themePickerDestination() === 'space' ? 'secondary' : 'ghost'}
                    onClick={() => setThemePickerDestination('space')}
                  >
                    This space
                  </we-button>
                </Row>
              </Column>

              <Row ax="end" gap="200">
                <we-button
                  size="sm"
                  variant="ghost"
                  onClick={() => setThemePickerOpen(false)}
                  disabled={themePickerSaving()}
                >
                  Cancel
                </we-button>
                <we-button
                  size="sm"
                  disabled={!themePickerName().trim()}
                  loading={themePickerSaving()}
                  onClick={handleThemePickerConfirm}
                >
                  {themePickerSaving() ? 'Creating...' : themePickerAction() === 'fresh' ? 'Create' : 'Fork'}
                </we-button>
              </Row>
            </Column>
          </Show>

          {/* Theme share dropdown (active editing state) */}
          <Show when={themeShareOpen()}>
            <Column
              position="absolute"
              top="100%"
              right="0"
              mt="100"
              bg="neutral-0"
              border="1px solid neutral-200"
              r="var(--we-theme-surface-radius, var(--we-radius-400))"
              shadow="md"
              overflow="hidden"
              minWidth="260px"
            >
              <Show when={themeShareView() === 'main'}>
                <Column py="200">
                  <Row
                    ay="center"
                    gap="400"
                    px="300"
                    py="200"
                    cursor={adamStore.marketplaceJoined() ? 'pointer' : 'not-allowed'}
                    opacity={adamStore.marketplaceJoined() ? 1 : 0.4}
                    hoverProps={adamStore.marketplaceJoined() ? { bg: 'neutral-100' } : undefined}
                    onClick={adamStore.marketplaceJoined() ? handlePublishThemeToMarketplace : undefined}
                  >
                    <we-icon name="storefront" color="neutral-600" />
                    <Column gap="0">
                      <we-text color="neutral-800">Upload to marketplace</we-text>
                      <we-text fontSize="300" color="neutral-500">
                        {adamStore.marketplaceJoined() ? 'Publish for others to install' : 'Marketplace not connected'}
                      </we-text>
                    </Column>
                  </Row>
                  <Row
                    ay="center"
                    gap="400"
                    px="300"
                    py="200"
                    cursor="pointer"
                    hoverProps={{ bg: 'neutral-100' }}
                    onClick={() => setThemeShareView('space')}
                  >
                    <we-icon name="users" color="neutral-600" />
                    <Column gap="0" flex="1">
                      <we-text color="neutral-800">Share to a space</we-text>
                      <we-text fontSize="300" color="neutral-500">
                        Copy to a space's themes
                      </we-text>
                    </Column>
                    <we-icon name="caret-right" color="neutral-400" size="sm" />
                  </Row>
                </Column>
              </Show>
              <Show when={themeShareView() === 'space'}>
                <Column>
                  <Row ay="center" gap="200" px="200" pt="200">
                    <we-button variant="ghost" square size="sm" onClick={() => setThemeShareView('main')}>
                      <we-icon name="arrow-left" />
                    </we-button>
                    <we-text fontWeight="600" color="neutral-800">
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
                            hoverProps={{ bg: 'neutral-100' }}
                            onClick={() => handleShareThemeToSpace(space.uuid, space.name)}
                          >
                            <we-avatar image={space.avatar} initials={space.name} size="sm" />
                            <we-text color="neutral-700" flex="1">
                              {space.name}
                            </we-text>
                            <Show when={themeShareLoading() === space.uuid}>
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

        {/* ── Template chip ── */}
        <Column position="relative">
          <Row
            ay="center"
            gap="100"
            bg="neutral-50"
            border="1px solid neutral-200"
            r="var(--we-theme-control-radius, var(--we-radius-400))"
            p="200"
          >
            {/* Template selector */}
            <we-tooltip title="Select a template" placement="bottom">
              <we-button variant="ghost" onClick={toggleSwitcher} p="200">
                <we-icon name={aiStore.templateIcon()} />
                <we-text>{aiStore.templateName()}</we-text>
                <we-icon name={open() ? 'caret-up' : 'caret-down'} color="neutral-500" />
              </we-button>
            </we-tooltip>

            <we-divider orientation="vertical" color="neutral-200" height="28px" />

            {/* Inactive: pencil opens edit dropdown */}
            <Show when={!aiStore.isEditingTemplate()}>
              <we-tooltip title="Edit template" placement="bottom">
                <we-button
                  variant={templateEditOpen() ? 'secondary' : 'ghost'}
                  square
                  onClick={toggleTemplateEditDropdown}
                >
                  <we-icon name="pencil-simple" />
                </we-button>
              </we-tooltip>
            </Show>

            {/* Active: share + ✕ */}
            <Show when={aiStore.isEditingTemplate()}>
              <we-tooltip title="Share" placement="bottom">
                <we-button
                  variant={templateShareOpen() ? 'secondary' : 'ghost'}
                  square
                  onClick={toggleTemplateShareDropdown}
                >
                  <we-icon name="share-network" />
                </we-button>
              </we-tooltip>
              <we-tooltip title="Exit template editing" placement="bottom">
                <we-button variant="ghost" square onClick={() => aiStore.exitTemplateEditing()}>
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
              r="var(--we-theme-surface-radius, var(--we-radius-400))"
              shadow="md"
              overflow="hidden"
              minWidth="300px"
            >
              <Search value={search()} placeholder="Search templates…" m="200" onSearch={setSearch} />
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
                            const isCurrent = createMemo(() => {
                              const isSpaceItem = template.id.startsWith('space::');
                              const realId = isSpaceItem ? template.id.slice('space::'.length) : template.id;
                              return (
                                realId === templateStore.currentTemplate.id &&
                                !!templateStore.currentTemplate._fromSpace === isSpaceItem
                              );
                            });
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
                                  closeAllDropdowns();
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

          {/* Template edit dropdown (pencil menu) */}
          <Show when={templateEditOpen()}>
            <Column
              position="absolute"
              top="100%"
              right="0"
              mt="100"
              bg="neutral-0"
              border="1px solid neutral-200"
              r="var(--we-theme-surface-radius, var(--we-radius-400))"
              shadow="md"
              overflow="hidden"
              minWidth="330px"
            >
              <Column py="200">
                <Show when={canEdit()}>
                  <Row
                    ay="center"
                    gap="400"
                    px="300"
                    py="200"
                    cursor="pointer"
                    hoverProps={{ bg: 'neutral-100' }}
                    onClick={() => {
                      aiStore.enterTemplateEditing('edit');
                      closeAllDropdowns();
                    }}
                  >
                    <we-icon name="pencil-simple" color="neutral-600" size="sm" />
                    <Column>
                      <we-text color="neutral-800">Edit</we-text>
                      <we-text fontSize="200" color="neutral-500">
                        Modify this template
                      </we-text>
                    </Column>
                  </Row>
                </Show>
                <Row
                  ay="center"
                  gap="400"
                  px="300"
                  py="200"
                  cursor="pointer"
                  hoverProps={{ bg: 'neutral-100' }}
                  onClick={() => {
                    closeAllDropdowns();
                    aiStore.startFork();
                  }}
                >
                  <we-icon name="git-fork" color="neutral-600" size="sm" />
                  <Column>
                    <we-text color="neutral-800">Fork</we-text>
                    <we-text fontSize="200" color="neutral-500">
                      Start a new template based on this one
                    </we-text>
                  </Column>
                </Row>
                <Row
                  ay="center"
                  gap="400"
                  px="300"
                  py="200"
                  cursor="pointer"
                  hoverProps={{ bg: 'neutral-100' }}
                  onClick={() => {
                    closeAllDropdowns();
                    aiStore.startFresh();
                  }}
                >
                  <we-icon name="file-plus" color="neutral-600" size="sm" />
                  <Column>
                    <we-text color="neutral-800">New</we-text>
                    <we-text fontSize="200" color="neutral-500">
                      Create a new template from scratch
                    </we-text>
                  </Column>
                </Row>
              </Column>
            </Column>
          </Show>

          {/* Template share dropdown (active editing state) */}
          <Show when={templateShareOpen()}>
            <Column
              position="absolute"
              top="100%"
              right="0"
              mt="100"
              bg="neutral-0"
              border="1px solid neutral-200"
              r="var(--we-theme-surface-radius, var(--we-radius-400))"
              shadow="md"
              overflow="hidden"
              minWidth="260px"
            >
              <Show when={shareView() === 'main'}>
                <Column py="200">
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
                  <Row
                    ay="center"
                    gap="400"
                    px="300"
                    py="200"
                    cursor={adamStore.marketplaceJoined() ? 'pointer' : 'not-allowed'}
                    opacity={adamStore.marketplaceJoined() ? 1 : 0.4}
                    hoverProps={adamStore.marketplaceJoined() ? { bg: 'neutral-100' } : undefined}
                    onClick={adamStore.marketplaceJoined() ? handlePublishTemplateToMarketplace : undefined}
                  >
                    <we-icon name="storefront" color="neutral-600" />
                    <Column gap="0">
                      <we-text color="neutral-800">Upload to marketplace</we-text>
                      <we-text fontSize="300" color="neutral-500">
                        {adamStore.marketplaceJoined() ? 'Publish for others to install' : 'Marketplace not connected'}
                      </we-text>
                    </Column>
                  </Row>
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

          {/* Name + icon picker (fork / start fresh) */}
          <Show when={aiStore.pickerOpen()}>
            <Column
              position="absolute"
              top="100%"
              right="0"
              mt="100"
              bg="neutral-0"
              border="1px solid neutral-200"
              r="var(--we-theme-surface-radius, var(--we-radius-400))"
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

      <Show when={publishModalOpen()}>
        <Portal>
          <PublishToMarketplaceModal type="template" onClose={() => setPublishModalOpen(false)} />
        </Portal>
      </Show>

      <Show when={publishThemeModalOpen()}>
        <Portal>
          <PublishToMarketplaceModal type="theme" onClose={() => setPublishThemeModalOpen(false)} />
        </Portal>
      </Show>
    </div>
  );
}
