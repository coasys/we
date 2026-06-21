import { Column, Row, SearchInput } from '@we/components/solid';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import { useAiStore } from '../stores/AiStore';
import { useSpaceStore } from '../stores/SpaceStore';
import { useTemplateStore } from '../stores/TemplateStore';

export function TemplateSwitcherChip() {
  const templateStore = useTemplateStore();
  const spaceStore = useSpaceStore();
  const aiStore = useAiStore();

  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  let containerRef: HTMLDivElement | undefined;

  const close = () => {
    setOpen(false);
    setSearch('');
  };

  const toggle = () => {
    const nowOpen = !open();
    if (!nowOpen) setSearch('');
    setOpen(nowOpen);
  };

  createEffect(() => {
    if (!open()) return;
    const onOutside = (e: MouseEvent) => {
      if (!containerRef?.contains(e.target as Node)) close();
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

  // Slide the whole row left when the AI panel is open
  const rowRight = () => (aiStore.isOpen() ? '410px' : '10px');

  return (
    <div style={{ position: 'fixed', inset: '0', 'pointer-events': 'none', 'z-index': '10' }}>
      {/* Outer row: edit toolbar (left, edit mode only) + chip (right, always) */}
      <Row
        ref={containerRef}
        position="absolute"
        top="10px"
        styles={{ right: rowRight(), transition: 'right 300ms ease' }}
        pointerEvents="auto"
        ay="start"
        gap="200"
      >
        {/* ── Edit-mode toolbar ── */}
        <Show when={aiStore.isEditMode()}>
          <Row ay="center" gap="100" bg="neutral-50" border="1px solid neutral-200" r="400" p="200">
            {/* Mode buttons */}
            <we-button
              variant={aiStore.contentMode() === 'preview' ? 'secondary' : 'ghost'}
              square
              onClick={() => aiStore.setContentMode('preview')}
            >
              <we-icon name="eye" />
            </we-button>
            <we-button
              variant={aiStore.contentMode() === 'visual' ? 'secondary' : 'ghost'}
              square
              onClick={() => aiStore.setContentMode('visual')}
            >
              <we-icon name="pencil-ruler" />
            </we-button>
            <we-button
              variant={aiStore.contentMode() === 'code' ? 'secondary' : 'ghost'}
              square
              onClick={() => aiStore.setContentMode('code')}
            >
              <we-icon name="code" />
            </we-button>

            <we-divider orientation="vertical" color="neutral-200" height="28px" />

            {/* Publish placeholder */}
            <we-button variant="ghost" square disabled>
              <we-icon name="upload-simple" />
            </we-button>

            {/* AI chat toggle */}
            <we-button variant={aiStore.isOpen() ? 'secondary' : 'ghost'} square onClick={() => aiStore.toggle()}>
              <we-icon name="chat-circle" />
            </we-button>
          </Row>
        </Show>

        {/* ── Template switcher chip ── */}
        <Column>
          <Row ay="center" gap="100" bg="neutral-50" border="1px solid neutral-200" r="400" p="200">
            {/* Template button */}
            <we-button variant="ghost" onClick={toggle} p="200">
              <we-icon name={aiStore.templateIcon()} />
              <we-text>{aiStore.templateName()}</we-text>
              <we-icon name={open() ? 'caret-up' : 'caret-down'} color="neutral-500" />
            </we-button>

            <we-divider orientation="vertical" color="neutral-200" height="28px" />

            {/* Edit / exit-edit button */}
            <we-button
              variant={aiStore.isEditMode() ? 'secondary' : 'ghost'}
              square
              onClick={() => (aiStore.isEditMode() ? aiStore.exitEditMode() : aiStore.enterEditMode())}
            >
              <we-icon name="pencil-simple" />
            </we-button>
          </Row>

          {/* Dropdown */}
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
                                  close();
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
        </Column>
      </Row>
    </div>
  );
}
