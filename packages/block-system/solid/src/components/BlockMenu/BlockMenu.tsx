import { Row } from '@we/components/solid';
import { createEffect, createSignal, onCleanup } from 'solid-js';

// Text blocks
const p = { type: 'p', label: 'Text', icon: 'text-t', md: '' };
const h1 = { type: 'h1', label: 'Heading 1', icon: 'text-h-one', md: '#' };
const h2 = { type: 'h2', label: 'Heading 2', icon: 'text-h-two', md: '##' };
const h3 = { type: 'h3', label: 'Heading 3', icon: 'text-h-three', md: '###' };
const quote = { type: 'quote', label: 'Quote', icon: 'quotes', md: '>' };
const ul = { type: 'ul', label: 'Bullet List', icon: 'list-bullets', md: '-' };
const ol = { type: 'ol', label: 'Number List', icon: 'list-numbers', md: '1.' };
// const cl = { type: 'cl', label: 'Check List', icon: 'list-checks', md: '[]' };

// Collection blocks
const grid = { type: 'grid', label: 'Grid', icon: 'squares-four', md: '+' };
const columns = { type: 'columns', label: 'Columns', icon: 'columns-plus-right', md: '||' };
const rows = { type: 'rows', label: 'Rows', icon: 'rows-plus-bottom', md: '=' };

// Media blocks
const url = { type: 'url', label: 'URL', icon: 'link', md: '!' };
const image = { type: 'image', label: 'Image', icon: 'image', md: '!!' };
const audio = { type: 'audio', label: 'Audio', icon: 'speaker-high', md: '!!!' };
const video = { type: 'video', label: 'Video', icon: 'youtube-logo', md: '!!!!' };
const file = { type: 'file', label: 'File', icon: 'paperclip', md: '!!!!!' };

// Social blocks
const event = { type: 'event', label: 'Event', icon: 'calendar', md: '' };
const task = { type: 'task', label: 'Task', icon: 'check-square', md: '' };
const poll = { type: 'poll', label: 'Poll', icon: 'chart-pie', md: '' };
const game = { type: 'game', label: 'game', icon: 'game-controller', md: '' };

const categories = [
  { title: 'Text', blocks: [p, h1, h2, h3, quote, ul, ol] },
  { title: 'Collection', blocks: [grid, columns, rows] },
  { title: 'Media', blocks: [url, image, audio, video, file] },
  { title: 'Social', blocks: [event, task, poll, game] },
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
  console.log('block menu open!!!', props.nodeType, props.position);
  const { nodeType, position, selectType, close } = props;
  const [focusIndex, setFocusIndex] = createSignal(-1);
  let menuRef: HTMLDivElement | undefined;

  function onMenuKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'ArrowUp') setFocusIndex((prev) => (prev > 0 ? prev - 1 : allBlocks.length - 1));
    if (e.key === 'ArrowDown') setFocusIndex((prev) => (prev < allBlocks.length - 1 ? prev + 1 : 0));
    if (['Backspace', 'Delete', 'Escape'].includes(e.key)) close();
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
    menuRef?.focus();

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
    const item = document.getElementById(`block-type-menu-${allBlocks[focusIndex()]?.type}`);
    if (item) item.focus();
  });

  return (
    <div
      ref={menuRef}
      class="we-block-menu"
      role="menu"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      onKeyDown={onMenuKeyDown}
    >
      {categories.map((category, index) => (
        <>
          {index > 0 && <div class="we-block-menu-divider" />}

          <span class="we-block-menu-category-title">{category.title}</span>

          {category.blocks.map((option, blockIndex) => (
            <button
              id={`block-type-menu-${option.type}`}
              class={`we-block-menu-item ${focusIndex() === category.offset + blockIndex ? 'we-block-menu-focused' : ''}`}
              role="menuitem"
              tabIndex={focusIndex() === category.offset + blockIndex ? 0 : -1}
              onMouseEnter={() => setFocusIndex(category.offset + blockIndex)}
              onClick={(e) => onOptionClick(e, option.type)}
              onKeyDown={(e) => onOptionKeyDown(e, option.type)}
            >
              <Row>
                <we-icon name={option.icon} weight="bold" color="ui-300" size="sm" style={{ margin: '0 10px 0 0' }} />
                {option.label}
              </Row>
              <span class="we-block-menu-markdown">{option.md}</span>
            </button>
          ))}
        </>
      ))}
    </div>
  );
}
