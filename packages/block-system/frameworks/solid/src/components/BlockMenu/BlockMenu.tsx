import { Row } from '@we/components/solid';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';

// Text blocks
const p = { type: 'p', label: 'Text', icon: 'text-t', md: '' };
const h1 = { type: 'h1', label: 'Heading 1', icon: 'text-h-one', md: '#' };
const h2 = { type: 'h2', label: 'Heading 2', icon: 'text-h-two', md: '##' };
const h3 = { type: 'h3', label: 'Heading 3', icon: 'text-h-three', md: '###' };
const quote = { type: 'quote', label: 'Quote', icon: 'quotes', md: '>' };
const ul = { type: 'ul', label: 'Bullet List', icon: 'list-bullets', md: '-' };
const ol = { type: 'ol', label: 'Number List', icon: 'list-numbers', md: '1.' };
// const cl = { type: 'cl', label: 'Check List', icon: 'list-checks', md: '[]' };

// // Collection blocks
const grid = { type: 'grid', label: 'Grid', icon: 'squares-four', md: '+' };
const column = { type: 'column', label: 'Column', icon: 'rows-plus-right', md: '=' };
const row = { type: 'row', label: 'Row', icon: 'columns-plus-bottom', md: '||' };

// Media blocks
const url = { type: 'link', label: 'URL', icon: 'link', md: '!' };
const image = { type: 'image', label: 'Image', icon: 'image', md: '!!' };
const audio = { type: 'audio', label: 'Audio', icon: 'speaker-high', md: '!!!' };
const video = { type: 'video', label: 'Video', icon: 'youtube-logo', md: '!!!!' };
const file = { type: 'file', label: 'File', icon: 'paperclip', md: '!!!!!' };

// // Social blocks
// const event = { type: 'event', label: 'Event', icon: 'calendar', md: '' };
// const task = { type: 'task', label: 'Task', icon: 'check-square', md: '' };
// const poll = { type: 'poll', label: 'Poll', icon: 'chart-pie', md: '' };
// const game = { type: 'game', label: 'game', icon: 'game-controller', md: '' };

const categories = [
  { title: 'Text', blocks: [p, h1, h2, h3, quote, ul, ol] },
  { title: 'Collection', blocks: [grid, column, row] },
  { title: 'Media', blocks: [url, image, audio, video, file] },
  // { title: 'Social', blocks: [event, task, poll, game] },
].map((category, index, arr) => ({
  ...category,
  offset: arr.slice(0, index).reduce((sum, cat) => sum + cat.blocks.length, 0),
}));

const allBlocks = categories.flatMap((category) => category.blocks);

export default function BlockTypeMenu(props: {
  nodeType: string;
  position: { top: number; left: number };
  selectType: (type: string) => void;
  close: () => void;
}) {
  const { nodeType, position, selectType, close } = props;
  const [focusIndex, setFocusIndex] = createSignal(-1);
  const [filter, setFilter] = createSignal('');
  let menuRef: HTMLDivElement | undefined;
  let filterRef: HTMLInputElement | undefined;

  const filteredCategories = createMemo(() => {
    const query = filter().toLowerCase().trim();
    if (!query) return categories;
    return categories
      .map((cat) => ({
        ...cat,
        blocks: cat.blocks.filter((b) => b.label.toLowerCase().includes(query)),
      }))
      .filter((cat) => cat.blocks.length > 0);
  });

  const filteredBlocks = createMemo(() => filteredCategories().flatMap((c) => c.blocks));

  function onMenuKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    const blocks = filteredBlocks();
    if (e.key === 'ArrowUp') setFocusIndex((prev) => (prev > 0 ? prev - 1 : blocks.length - 1));
    if (e.key === 'ArrowDown') setFocusIndex((prev) => (prev < blocks.length - 1 ? prev + 1 : 0));
    if (e.key === 'Escape') close();
  }

  function onOptionKeyDown(e: KeyboardEvent, type: string) {
    if (['Enter', ' '].includes(e.key)) {
      e.preventDefault();
      selectType(type);
      close();
    }
  }

  function onOptionClick(e: MouseEvent, type: string) {
    e.stopPropagation();
    selectType(type);
    close();
  }

  // Initialize focus and set up click outside listener
  createEffect(() => {
    filterRef?.focus();

    // Set the focus index on the current node type
    const index = allBlocks.findIndex((item) => item.type === nodeType);
    setFocusIndex(index >= 0 ? index : 0);

    function handleClickOutside(e: MouseEvent) {
      if (!menuRef?.contains(e.target as Node)) close();
    }

    document.addEventListener('mousedown', handleClickOutside);
    onCleanup(() => document.removeEventListener('mousedown', handleClickOutside));
  });

  // Update selection focus when focusIndex changes
  createEffect(() => {
    const item = document.getElementById(`block-type-menu-${filteredBlocks()[focusIndex()]?.type}`);
    if (item) item.scrollIntoView({ block: 'nearest' });
  });

  // Reset focus index when filter changes
  createEffect(() => {
    filter();
    setFocusIndex(filteredBlocks().length > 0 ? 0 : -1);
  });

  return (
    <div
      ref={menuRef}
      class="we-block-menu"
      role="menu"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      onKeyDown={onMenuKeyDown}
    >
      <Row ay="center" gap="200" p="200">
        <we-icon name="magnifying-glass" size="xs" color="neutral-400" />
        <input
          ref={filterRef}
          class="we-block-menu-filter"
          type="text"
          placeholder="Filter blocks..."
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filteredBlocks().length > 0) {
              e.preventDefault();
              const block = filteredBlocks()[focusIndex()];
              if (block) {
                selectType(block.type);
                close();
              }
            }
          }}
        />
      </Row>
      <we-divider mt="200" mb="400" />
      <Show when={filteredBlocks().length > 0} fallback={<div class="we-block-menu-empty">No matching blocks</div>}>
        {filteredCategories().map((category, index) => {
          const offset = () =>
            filteredCategories()
              .slice(0, index)
              .reduce((sum, cat) => sum + cat.blocks.length, 0);
          return (
            <>
              {index > 0 && <div class="we-block-menu-divider" />}

              <we-text fontSize="300" fontWeight="600" textTransform="uppercase" color="neutral-600" mb="100">
                {category.title}
              </we-text>

              {category.blocks.map((option, blockIndex) => (
                <button
                  id={`block-type-menu-${option.type}`}
                  class={`we-block-menu-item ${focusIndex() === offset() + blockIndex ? 'we-block-menu-focused' : ''}`}
                  role="menuitem"
                  tabIndex={focusIndex() === offset() + blockIndex ? 0 : -1}
                  onMouseEnter={() => setFocusIndex(offset() + blockIndex)}
                  onClick={(e) => onOptionClick(e, option.type)}
                  onKeyDown={(e) => onOptionKeyDown(e, option.type)}
                >
                  <Row ay="center" gap="300">
                    <we-icon name={option.icon} weight="bold" color="neutral-400" size="sm" />
                    <we-text fontSize="400">{option.label}</we-text>
                  </Row>
                  <we-text fontSize="400" color="neutral-500">
                    {option.md}
                  </we-text>
                </button>
              ))}
            </>
          );
        })}
      </Show>
    </div>
  );
}
