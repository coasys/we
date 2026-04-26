import { icons as _phosphorIcons } from '@phosphor-icons/core';
import type { DesignSystemProps } from '@we/design-types';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

const PHOSPHOR_ICON_NAMES: readonly string[] = _phosphorIcons.map((i) => i.name);

// Detect whether a string looks like a Phosphor icon name (kebab-case, ASCII only)
function isPhosphorName(v: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(v);
}

// Common emoji quick-picks
const EMOJI_QUICK_PICKS = [
  '❤️',
  '👍',
  '👎',
  '⭐',
  '🔥',
  '💡',
  '✅',
  '❌',
  '🎉',
  '🚀',
  '💯',
  '⚡',
  '🌟',
  '👁️',
  '🎯',
  '📌',
  '🔔',
  '💬',
  '🤝',
  '🌍',
  '🧠',
  '📊',
  '⚖️',
  '🎓',
  '💪',
  '🙏',
  '😂',
  '😮',
  '😢',
  '❓',
  '⚠️',
  '🔒',
];

const GRID_PAGE_SIZE = 80;

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline-flex',
  direction: 'column',
  gap: '200',
};

const CONTROL_HEIGHT: Record<ComponentSize, string> = {
  xs: 'var(--we-component-height-xs)',
  sm: 'var(--we-component-height-sm)',
  md: 'var(--we-component-height-md)',
  lg: 'var(--we-component-height-lg)',
  xl: 'var(--we-component-height-xl)',
};

const styles = css`
  :host {
    position: relative;
    min-width: 0;
  }

  [part='trigger'] {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: var(--we-space-200);
    border: 1px solid var(--we-color-neutral-300);
    border-radius: var(--we-radius-400);
    background: var(--we-color-neutral-0);
    padding: 0 var(--we-space-300);
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.15s ease;
    width: 100%;
    box-sizing: border-box;
  }

  [part='trigger']:focus-visible {
    border-color: var(--we-color-primary-500);
    outline: 2px solid var(--we-color-primary-100);
    outline-offset: -1px;
  }

  [part='trigger']:hover:not([disabled]) {
    border-color: var(--we-color-neutral-400);
  }

  [part='preview-icon'] {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1em;
    line-height: 1;
  }

  [part='placeholder'] {
    color: var(--we-color-neutral-400);
    font-size: var(--we-font-size-400);
    flex: 1;
  }

  [part='label'] {
    color: var(--we-color-neutral-700);
    font-size: var(--we-font-size-400);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  [part='caret'] {
    color: var(--we-color-neutral-400);
    margin-left: auto;
  }

  /* Popover panel */
  [part='popover'] {
    position: fixed;
    z-index: var(--we-z-dropdown, 9999);
    min-width: 320px;
    max-width: 380px;
    background: var(--we-color-neutral-0);
    border: 1px solid var(--we-color-neutral-200);
    border-radius: var(--we-radius-500);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    padding: var(--we-space-400);
    display: flex;
    flex-direction: column;
    gap: var(--we-space-300);
  }

  /* Tabs */
  [part='tabs'] {
    display: flex;
    gap: var(--we-space-100);
    border-bottom: 1px solid var(--we-color-neutral-100);
    padding-bottom: var(--we-space-200);
  }

  [part='tab'] {
    all: unset;
    cursor: pointer;
    padding: var(--we-space-100) var(--we-space-300);
    border-radius: var(--we-radius-300);
    font-size: var(--we-font-size-300);
    font-weight: 500;
    color: var(--we-color-neutral-500);
    transition:
      background 0.1s ease,
      color 0.1s ease;
  }

  [part='tab']:hover {
    background: var(--we-color-neutral-50);
    color: var(--we-color-neutral-700);
  }

  [part='tab'][aria-selected='true'] {
    background: var(--we-color-primary-50);
    color: var(--we-color-primary-600);
  }

  /* Search */
  [part='search'] {
    all: unset;
    display: block;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--we-color-neutral-300);
    border-radius: var(--we-radius-400);
    padding: var(--we-space-200) var(--we-space-300);
    font-size: var(--we-font-size-300);
    background: var(--we-color-neutral-0);
    color: var(--we-color-neutral-900);
    transition: border-color 0.15s ease;
  }

  [part='search']:focus {
    border-color: var(--we-color-primary-500);
    outline: 2px solid var(--we-color-primary-100);
    outline-offset: -1px;
  }

  [part='search']::placeholder {
    color: var(--we-color-neutral-400);
  }

  /* Icon grid */
  [part='icon-grid'] {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
    max-height: 220px;
    overflow-y: auto;
  }

  [part='icon-btn'] {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--we-radius-300);
    cursor: pointer;
    border: 1px solid transparent;
    transition:
      background 0.1s ease,
      border-color 0.1s ease;
  }

  [part='icon-btn']:hover {
    background: var(--we-color-neutral-50);
    border-color: var(--we-color-neutral-200);
  }

  [part='icon-btn'][aria-selected='true'] {
    background: var(--we-color-primary-50);
    border-color: var(--we-color-primary-400);
  }

  /* Load more */
  [part='load-more'] {
    all: unset;
    display: block;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    padding: var(--we-space-200);
    font-size: var(--we-font-size-300);
    color: var(--we-color-primary-500);
    cursor: pointer;
    border-radius: var(--we-radius-300);
    transition: background 0.1s ease;
  }

  [part='load-more']:hover {
    background: var(--we-color-neutral-50);
  }

  [part='no-results'] {
    text-align: center;
    color: var(--we-color-neutral-400);
    font-size: var(--we-font-size-300);
    padding: var(--we-space-400) 0;
  }

  /* Emoji tab */
  [part='emoji-grid'] {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }

  [part='emoji-btn'] {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--we-radius-300);
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 1.2em;
    line-height: 1;
    transition:
      background 0.1s ease,
      border-color 0.1s ease;
  }

  [part='emoji-btn']:hover {
    background: var(--we-color-neutral-50);
    border-color: var(--we-color-neutral-200);
  }

  [part='emoji-btn'][aria-selected='true'] {
    background: var(--we-color-primary-50);
    border-color: var(--we-color-primary-400);
  }

  [part='emoji-input-label'] {
    font-size: var(--we-font-size-300);
    color: var(--we-color-neutral-500);
    margin-bottom: 4px;
  }

  [part='emoji-input'] {
    all: unset;
    display: block;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--we-color-neutral-300);
    border-radius: var(--we-radius-400);
    padding: var(--we-space-200) var(--we-space-300);
    font-size: var(--we-font-size-500);
    text-align: center;
    background: var(--we-color-neutral-0);
    color: var(--we-color-neutral-900);
    transition: border-color 0.15s ease;
  }

  [part='emoji-input']:focus {
    border-color: var(--we-color-primary-500);
    outline: 2px solid var(--we-color-primary-100);
    outline-offset: -1px;
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

type Tab = 'icons' | 'emoji';

@customElement('we-icon-picker')
export default class IconPicker extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) value = '';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String }) name = '';
  @property({ type: String }) size: ComponentSize = 'md';
  @property({ type: String }) placeholder = 'Pick icon';

  @state() private _open = false;
  @state() private _tab: Tab = 'icons';
  @state() private _search = '';
  @state() private _page = 1;
  @state() private _emojiInput = '';
  @state() private _popoverTop = 0;
  @state() private _popoverLeft = 0;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onDocClick = this._onDocClick.bind(this);
    document.addEventListener('click', this._onDocClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDocClick);
  }

  private _onDocClick(e: Event) {
    if (!e.composedPath().includes(this)) this._open = false;
  }

  private _open_picker() {
    if (this.disabled) return;
    this._open = !this._open;
    if (this._open) {
      // Auto-select correct tab for current value
      if (this.value && !isPhosphorName(this.value)) {
        this._tab = 'emoji';
      } else {
        this._tab = 'icons';
      }
      this._search = '';
      this._page = 1;
      // Position the fixed popover below the trigger
      const trigger = this.renderRoot.querySelector<HTMLElement>('[part="trigger"]');
      if (trigger) {
        const rect = trigger.getBoundingClientRect();
        this._popoverTop = rect.bottom + 4;
        this._popoverLeft = rect.left;
      }
    }
  }

  private _select(val: string) {
    this.value = val;
    this._open = false;
    this.dispatchEvent(new CustomEvent('change', { detail: val, bubbles: true, composed: true }));
  }

  private _onSearch(e: Event) {
    this._search = (e.target as HTMLInputElement).value;
    this._page = 1;
  }

  private _onEmojiInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    this._emojiInput = raw;
    if (raw) this._select(raw);
  }

  private _filteredIcons(): string[] {
    const q = this._search.trim().toLowerCase();
    if (!q) return PHOSPHOR_ICON_NAMES as string[];
    return (PHOSPHOR_ICON_NAMES as string[]).filter((n) => n.includes(q));
  }

  private _renderTrigger() {
    const h = CONTROL_HEIGHT[this.size];
    const hasValue = Boolean(this.value);

    return html`
      <button
        part="trigger"
        style="height:${h}"
        @click=${this._open_picker}
        aria-haspopup="listbox"
        aria-expanded=${this._open}
        ?disabled=${this.disabled}
      >
        ${hasValue
          ? html`
              <span part="preview-icon">
                <we-icon name=${this.value} size="sm"></we-icon>
              </span>
              ${isPhosphorName(this.value) ? html`<span part="label">${this.value}</span>` : nothing}
            `
          : html`<span part="placeholder">${this.placeholder}</span>`}
        <span part="caret"><we-icon name="caret-down" size="sm"></we-icon></span>
      </button>
    `;
  }

  private _renderIconsTab() {
    const results = this._filteredIcons();
    const visible = results.slice(0, this._page * GRID_PAGE_SIZE);
    const hasMore = visible.length < results.length;

    return html`
      <input
        part="search"
        type="search"
        placeholder="Search icons…"
        autocomplete="off"
        .value=${this._search}
        @input=${this._onSearch}
      />
      ${results.length === 0
        ? html`<div part="no-results">No icons match "${this._search}"</div>`
        : html`
            <div part="icon-grid" role="listbox">
              ${visible.map(
                (name) => html`
                  <button
                    part="icon-btn"
                    role="option"
                    title=${name}
                    aria-selected=${name === this.value ? 'true' : 'false'}
                    @click=${() => this._select(name)}
                  >
                    <we-icon name=${name} size="sm"></we-icon>
                  </button>
                `,
              )}
            </div>
            ${hasMore
              ? html`
                  <button part="load-more" @click=${() => (this._page += 1)}>
                    Show more (${results.length - visible.length} remaining)
                  </button>
                `
              : nothing}
          `}
    `;
  }

  private _renderEmojiTab() {
    return html`
      <div part="emoji-grid" role="listbox">
        ${EMOJI_QUICK_PICKS.map(
          (emoji) => html`
            <button
              part="emoji-btn"
              role="option"
              title=${emoji}
              aria-selected=${emoji === this.value ? 'true' : 'false'}
              @click=${() => this._select(emoji)}
            >
              ${emoji}
            </button>
          `,
        )}
      </div>
      <div>
        <div part="emoji-input-label">Or type / paste any emoji:</div>
        <input
          part="emoji-input"
          type="text"
          placeholder="✨"
          .value=${!isPhosphorName(this.value) ? this.value : this._emojiInput}
          @input=${this._onEmojiInput}
        />
      </div>
    `;
  }

  render() {
    return html`
      ${this._renderTrigger()}
      ${this._open
        ? html`
            <div part="popover" role="dialog" style="top:${this._popoverTop}px;left:${this._popoverLeft}px">
              <div part="tabs" role="tablist">
                <button
                  part="tab"
                  role="tab"
                  aria-selected=${this._tab === 'icons' ? 'true' : 'false'}
                  @click=${() => {
                    this._tab = 'icons';
                    this._search = '';
                    this._page = 1;
                  }}
                >
                  Icons
                </button>
                <button
                  part="tab"
                  role="tab"
                  aria-selected=${this._tab === 'emoji' ? 'true' : 'false'}
                  @click=${() => {
                    this._tab = 'emoji';
                  }}
                >
                  Emoji
                </button>
              </div>
              ${this._tab === 'icons' ? this._renderIconsTab() : this._renderEmojiTab()}
            </div>
          `
        : nothing}
    `;
  }
}
