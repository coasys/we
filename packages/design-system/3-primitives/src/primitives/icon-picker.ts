import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { DesignSystemElement } from '../shared/design-system-element';
import { fieldSurface } from '../shared/field-surface';
import { openFloatingPanel } from '../shared/floating-panel';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

/**
 * The icon catalogue arrives when the picker is first opened.
 *
 * `@phosphor-icons/core` is ~300 KB of metadata for the full set, and it is needed only to list and
 * filter names in this one panel — `we-icon` renders from the CDN and never reads it. Loading it at
 * import time put that on every page that so much as includes the design system.
 *
 * Module-level, so the second picker to open pays nothing.
 */
let PHOSPHOR_ICON_NAMES: readonly string[] = [];
let phosphorLoad: Promise<readonly string[]> | undefined;

function loadPhosphorNames(): Promise<readonly string[]> {
  phosphorLoad ??= import('@phosphor-icons/core').then(({ icons }) => {
    PHOSPHOR_ICON_NAMES = icons.map((i) => i.name);
    return PHOSPHOR_ICON_NAMES;
  });
  return phosphorLoad;
}

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

/**
 * Type scale per size, applied to the host so the trigger's own text inherits it — the same map
 * `we-select`, `we-input` and `we-date-picker` carry. Without it `size` set the control's height
 * and nothing else, so a small picker held full-size text.
 */
const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100' },
  sm: { fontSize: '200' },
  md: { fontSize: '300' },
  lg: { fontSize: '400' },
  xl: { fontSize: '400' },
};

const CONTROL_HEIGHT: Record<ComponentSize, string> = {
  xs: 'calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px))',
  sm: 'calc(var(--we-component-height-sm) + var(--we-theme-control-height-offset, 0px))',
  md: 'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px))',
  lg: 'calc(var(--we-component-height-lg) + var(--we-theme-control-height-offset, 0px))',
  xl: 'calc(var(--we-component-height-xl) + var(--we-theme-control-height-offset, 0px))',
};

const styles = css`
  :host {
    position: relative;
    min-width: 0;
  }

  /* Icon sizing context, so the trigger's own icons scale with the control (see we-textarea). */
  :host([size='xs']) {
    --we-context-icon-size: var(--we-size-xxs);
  }
  :host([size='sm']) {
    --we-context-icon-size: var(--we-size-xs);
  }
  :host([size='md']) {
    --we-context-icon-size: var(--we-size-sm);
  }
  :host([size='lg']) {
    --we-context-icon-size: var(--we-size-md);
  }
  :host([size='xl']) {
    --we-context-icon-size: var(--we-size-lg);
  }

  [part='trigger'] {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: var(--we-space-200);
    padding: 0 var(--we-space-300);
    cursor: pointer;
    white-space: nowrap;
    width: 100%;
    box-sizing: border-box;
  }

  /* After the reset above, never before it: all:unset clears border, radius and background. */
  ${fieldSurface("[part='trigger']")}

  [part='preview-icon'] {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1em;
    line-height: 1;
  }

  /* Both inherit the host's type size (see SIZE_DEFAULTS) rather than pinning one of their own. */
  [part='placeholder'] {
    color: var(--we-role-text-faint);
    flex: 1;
  }

  [part='label'] {
    color: var(--we-role-text);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  [part='caret'] {
    color: var(--we-role-text-faint);
    margin-left: auto;
  }

  /* Popover panel */
  [part='popover'] {
    position: fixed;
    /* Reset UA [popover] defaults */
    margin: 0;
    inset: unset;
    /* Component styles */
    z-index: var(--we-z-dropdown, 9999);
    min-width: 320px;
    max-width: 380px;
    background: var(--we-role-surface-raised);
    border: 1px solid var(--we-role-border);
    border-radius: var(--we-radius-500);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--we-role-shadow-color) 12%, transparent);
    padding: var(--we-space-400);
    display: flex;
    flex-direction: column;
    gap: var(--we-space-300);
  }

  /* Tabs */
  [part='tabs'] {
    display: flex;
    gap: var(--we-space-100);
    border-bottom: 1px solid var(--we-role-border);
    padding-bottom: var(--we-space-200);
  }

  [part='tab'] {
    all: unset;
    cursor: pointer;
    padding: var(--we-space-100) var(--we-space-300);
    border-radius: var(--we-radius-300);
    font-size: var(--we-font-size-300);
    font-weight: 500;
    color: var(--we-role-text-muted);
    transition:
      background var(--we-transition-200, 150ms) ease,
      color var(--we-transition-200, 150ms) ease;
  }

  [part='tab']:hover {
    background: var(--we-role-page);
    color: var(--we-role-text);
  }

  [part='tab'][aria-selected='true'] {
    background: var(--we-role-accent-muted);
    color: var(--we-role-accent-text);
  }

  /* Search */
  [part='search'] {
    all: unset;
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: var(--we-space-200) var(--we-space-300);
    font-size: var(--we-font-size-300);
    color: var(--we-role-text);
  }

  /*
    A well inside the popover's raised panel, which is the same relationship a field has to a card.
    Focus-within rather than focus-visible, because this is a real text field and the ring has to
    follow the caret whether it was reached by click or by Tab.
  */
  ${fieldSurface("[part='search']", ':focus-within')}

  [part='search']::placeholder {
    color: var(--we-role-text-faint);
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
      background var(--we-transition-200, 150ms) ease,
      border-color var(--we-transition-200, 150ms) ease;
  }

  [part='icon-btn']:hover {
    background: var(--we-role-page);
    border-color: var(--we-role-border);
  }

  [part='icon-btn'][aria-selected='true'] {
    background: var(--we-role-accent-muted);
    border-color: var(--we-role-accent);
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
    color: var(--we-role-accent);
    cursor: pointer;
    border-radius: var(--we-radius-300);
    transition: background var(--we-transition-200, 150ms) ease;
  }

  [part='load-more']:hover {
    background: var(--we-role-page);
  }

  [part='no-results'] {
    text-align: center;
    color: var(--we-role-text-faint);
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
      background var(--we-transition-200, 150ms) ease,
      border-color var(--we-transition-200, 150ms) ease;
  }

  [part='emoji-btn']:hover {
    background: var(--we-role-page);
    border-color: var(--we-role-border);
  }

  [part='emoji-btn'][aria-selected='true'] {
    background: var(--we-role-accent-muted);
    border-color: var(--we-role-accent);
  }

  [part='emoji-input-label'] {
    font-size: var(--we-font-size-300);
    color: var(--we-role-text-muted);
    margin-bottom: 4px;
  }

  [part='emoji-input'] {
    all: unset;
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: var(--we-space-200) var(--we-space-300);
    font-size: var(--we-font-size-500);
    text-align: center;
    color: var(--we-role-text);
  }

  ${fieldSurface("[part='emoji-input']", ':focus-within')}

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
  /** What this picker is called, for a reader who cannot see the field label beside it. */
  @property({ type: String }) label = '';
  // Reflected so the `:host([size=…])` rules above can see it — they are what scales the icons.
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: String }) placeholder = 'Pick icon';

  @state() private _open = false;
  @state() private _tab: Tab = 'icons';
  @state() private _search = '';
  @state() private _page = 1;
  @state() private _emojiInput = '';
  /** Teardown for the open panel: stops the position watcher and leaves the top layer. */
  private _closeFloating?: () => void;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof IconPicker & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onDocClick = this._onDocClick.bind(this);
    document.addEventListener('click', this._onDocClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._closeFloating?.();
    document.removeEventListener('click', this._onDocClick);
  }

  private _onDocClick(e: Event) {
    if (!e.composedPath().includes(this)) this._close();
  }

  /**
   * Close, and tear down the floating anchor.
   *
   * The two used to be separate, and one of the four ways to close this did not do the second: an
   * outside click set `_open = false` and left `_closeFloating` unread, so every dismissal by
   * clicking elsewhere leaked a Floating UI `autoUpdate` — a scroll and resize listener set, per
   * open, for the life of the page. Opening and dismissing a picker twenty times leaves twenty of
   * them recomputing a position for a panel that is not there.
   */
  private _close() {
    this._open = false;
    this._closeFloating?.();
    this._closeFloating = undefined;
  }

  /**
   * Escape closes it, and the trigger is a real button.
   *
   * The picker had no Escape at all: a keyboard user who opened it could tab through the grid and
   * out the other side, with the panel still up and no way to dismiss it. Every other overlay in
   * the set answers Escape, and being the one that does not is worse than never having opened.
   */
  private _onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this._open) {
      e.stopPropagation();
      this._close();
      this.renderRoot.querySelector<HTMLElement>('[part="trigger"]')?.focus();
    }
  };

  private _open_picker() {
    if (this.disabled) return;
    this._open = !this._open;
    if (this._open) {
      // Names may not be here yet; re-render once they are. The panel renders its emoji tab and an
      // empty icon grid in the meantime rather than blocking the open.
      if (!PHOSPHOR_ICON_NAMES.length) void loadPhosphorNames().then(() => this.requestUpdate());
      // Auto-select correct tab for current value
      if (this.value && !isPhosphorName(this.value)) {
        this._tab = 'emoji';
      } else {
        this._tab = 'icons';
      }
      this._search = '';
      this._page = 1;
      // After Lit has rendered the panel: promoted into the top layer and anchored to the trigger,
      // by the same helper the select and the date picker use. It used to be placed once from a
      // rect read here, which meant it stayed where the trigger *was* as soon as anything scrolled.
      requestAnimationFrame(() => {
        this._closeFloating = openFloatingPanel(
          this.renderRoot.querySelector<HTMLElement>('[part="trigger"]'),
          this.renderRoot.querySelector<HTMLElement>('[part="popover"]'),
        );
      });
    } else {
      this._close();
    }
  }

  private _select(val: string) {
    this.value = val;
    this._open = false;
    this._closeFloating?.();
    this._closeFloating = undefined;
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
        @keydown=${this._onKeyDown}
        aria-haspopup="listbox"
        aria-expanded=${this._open}
        aria-label=${this.label || nothing}
        ?disabled=${this.disabled}
      >
        ${
          hasValue
            ? html`
                <span part="preview-icon">
                  <we-icon name=${this.value} color="black"></we-icon>
                </span>
                ${isPhosphorName(this.value) ? html`<span part="label">${this.value}</span>` : nothing}
              `
            : html`<span part="placeholder">${this.placeholder}</span>`
        }
        <span part="caret"><we-icon name="caret-down" color="black"></we-icon></span>
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
      ${
        results.length === 0
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
                      <we-icon name=${name} size="sm" color="black"></we-icon>
                    </button>
                  `,
                )}
              </div>
              ${
                hasMore
                  ? html`
                      <button part="load-more" @click=${() => (this._page += 1)}>
                        Show more (${results.length - visible.length} remaining)
                      </button>
                    `
                  : nothing
              }
            `
      }
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
      ${
        this._open
          ? html`
              <div part="popover" role="dialog" aria-label="Choose an icon" @keydown=${this._onKeyDown}>
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
          : nothing
      }
    `;
  }
}
