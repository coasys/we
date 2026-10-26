import type { DesignSystemProps } from '@we/design-types';
import { componentThemeVar, FOCUS_RING } from '@we/tokens';
import { css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

/*
  The space between rows, at every depth: between a tree's top-level items, between a row and the
  rows under it, and between those. A theme sets it as the tree's own gap (components.tree.gap).
  On the tree's and each item's base, as their DS gap, since a primitive's base reads its gap
  from its own DS variable and a stylesheet rule never reaches it; and on an item's children.
  Rows used to touch, so two rows lit at once — the one hovered and the one you are on — read as one
  block.
*/
const ROW_GAP_VALUE = `var(${componentThemeVar('tree', 'gap')}, var(--we-space-100))`;

/*
  Rows stack. A DesignSystemElement host is a flex container around its `base` part, which is laid
  out as a row unless the element says otherwise: a tree left at the default drew its groups side by
  side on one line, and an open row's children beside it rather than under it. `we-menu` declares
  the same for the same reason.
*/
const STACKED: Partial<DesignSystemProps> = { direction: 'column', gap: ROW_GAP_VALUE };

const TREE_STYLES = css`
  :host {
    display: block;
  }
`;

/**
 * A tree — the space as a file browser, a folder list, an outline. The root of one, holding its items.
 *
 * ## One root, items to any depth
 *
 * The data a tree shows is usually fractal (a channel holds channels), and so is `we-tree-item`: an
 * item's children are more items, nested inside it. The widget is not: there is exactly one
 * `we-tree`, because ARIA allows one `tree` per widget and the keyboard treats every visible row as a
 * single list. Arrow-down from the last row of a sub-channel lands on its parent's next sibling, and
 * Tab enters and leaves the tree once. A `we-tree` per level would make every subtree its own tab stop
 * and its own island of focus, and a screen reader would announce a dozen trees.
 *
 * ## The keyboard
 *
 * Roving focus: one row is the tab stop, the arrows move it. Down and Up walk the visible rows in
 * order; Right opens a closed row, or steps into an open one; Left closes an open row, or steps out to
 * its parent; Home and End go to the ends; Enter and Space select. Typing a letter moves to the next
 * row whose label starts with it. This is the WAI-ARIA tree pattern, and it lives here, once, so no
 * template has to write it.
 *
 * ## What it emits, and what it does not decide
 *
 * `select` — `{ value }` — when a row is chosen, by click or key. What choosing means (navigating,
 * filtering) is the template's business. Which row is selected is the template's too: pass
 * `selected` and the matching item marks itself, so a selection driven by the address stays in step.
 */
@customElement('we-tree')
export class Tree extends DesignSystemElement {
  static styles = [sharedStyles, TREE_STYLES];

  static getDefaultProps() {
    return STACKED;
  }

  /** The value of the selected row, if any — matched against each item's `value`. */
  @property({ type: String }) selected = '';
  /** What the tree is, for a screen reader: "Space", "Channels". */
  @property({ type: String }) label = '';

  /*
    `querySelectorAll` rather than slotted elements: the schema renderer wraps children in
    `display: contents` divs, so what is assigned to a slot is the wrapper and never the item — the
    same reason `we-tabs` reads its tabs this way. Items nest in light DOM, so this finds them at any
    depth, in document order, which is the order the rows are read in.
  */
  private get items(): TreeItem[] {
    return [...this.querySelectorAll('we-tree-item')] as TreeItem[];
  }

  /** Rows a person can see: every ancestor open. */
  private get visibleItems(): TreeItem[] {
    return this.items.filter((item) => item.isVisibleInTree());
  }

  updated(changed: Map<PropertyKey, unknown>) {
    super.updated(changed);
    this.syncItems();
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('tree-item-select', this.onItemSelect as EventListener);
    this.addEventListener('tree-item-focus', this.onItemFocus as EventListener);
    // Items mount after the tree; let them settle, then give exactly one of them the tab stop.
    this.mutations = new MutationObserver(() => this.syncItems());
    this.mutations.observe(this, { childList: true, subtree: true });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
    this.removeEventListener('tree-item-select', this.onItemSelect as EventListener);
    this.removeEventListener('tree-item-focus', this.onItemFocus as EventListener);
    this.mutations?.disconnect();
  }

  private mutations?: MutationObserver;
  /** The row holding the tab stop, by value — kept across re-renders of the rows themselves. */
  private focusedValue = '';

  /** Mark the selected row, and make exactly one visible row the tab stop. */
  private syncItems() {
    const visible = this.visibleItems;
    for (const item of this.items) {
      item.selected = !!this.selected && item.value === this.selected;
      item.level = item.depthInTree();
    }
    const stop =
      visible.find((item) => item.value === this.focusedValue) ?? visible.find((item) => item.selected) ?? visible[0];
    for (const item of this.items) item.tabStop = item === stop;
  }

  private onItemSelect = (event: CustomEvent<{ value: string }>) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('select', { detail: { value: event.detail.value }, bubbles: true, composed: true }),
    );
  };

  private onItemFocus = (event: CustomEvent<{ value: string }>) => {
    this.focusedValue = event.detail.value;
    this.syncItems();
  };

  private typeahead = '';
  private typeaheadTimer?: ReturnType<typeof setTimeout>;

  private onKeyDown = (event: KeyboardEvent) => {
    const target = (event.composedPath().find((node) => node instanceof TreeItem) as TreeItem | undefined) ?? null;
    if (!target) return;
    // Typing inside something a row holds — a rename field — is typing, never navigation.
    const origin = event.composedPath()[0] as HTMLElement | undefined;
    if (origin && (origin.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(origin.tagName))) return;

    const rows = this.visibleItems;
    const at = rows.indexOf(target);
    const go = (row: TreeItem | undefined) => {
      if (!row) return;
      event.preventDefault();
      row.focusRow();
    };

    switch (event.key) {
      case 'ArrowDown':
        return go(rows[at + 1]);
      case 'ArrowUp':
        return go(rows[at - 1]);
      case 'Home':
        return go(rows[0]);
      case 'End':
        return go(rows[rows.length - 1]);
      case 'ArrowRight':
        if (!target.hasChildren()) return;
        event.preventDefault();
        if (!target.open) target.setOpen(true);
        else target.firstChildItem()?.focusRow();
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (target.open && target.hasChildren()) target.setOpen(false);
        else target.parentItem()?.focusRow();
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        target.choose();
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          clearTimeout(this.typeaheadTimer);
          this.typeahead += event.key.toLowerCase();
          this.typeaheadTimer = setTimeout(() => (this.typeahead = ''), 600);
          const after = [...rows.slice(at + 1), ...rows.slice(0, at + 1)];
          go(after.find((row) => row.textLabel().toLowerCase().startsWith(this.typeahead)));
        }
    }
  };

  render() {
    return html`<div part="base" role="tree" aria-label=${this.label || ''}><slot></slot></div>`;
  }
}

/*
  A row's corners read its own override slot (--we-theme-tree-radius), so a theme can round rows
  without rounding every control.

  The selected row reads the tree's `selected` variant, the component tier's usual vocabulary:
  `components: { tree: { variants: { selected: { fill, text, border, borderWidth } } } }`. Fill and
  text replace the selected role's. Border and its width draw a bar on the row's leading edge — the
  mark a navigation tree draws on the row you are on, and what Coasys Glow asks for in mint. Unset,
  the bar has no width, so every theme that says nothing renders as before.

  Read from the variant only, not the tree's own keys: a `fill` set for every row would otherwise
  paint the selected one too, and the selection would disappear into it.
*/
const SELECTED = (key: string, fallback: string) =>
  unsafeCSS(`var(${componentThemeVar('tree', key, 'selected')}, ${fallback})`);

const ITEM_STYLES = css`
  :host {
    display: block;
  }
  [part='children'] {
    display: flex;
    flex-direction: column;
    gap: ${unsafeCSS(ROW_GAP_VALUE)};
  }
  [part='row'] {
    display: flex;
    align-items: center;
    gap: var(--we-space-200);
    padding: var(--we-tree-row-padding, var(--we-space-100) var(--we-space-200));
    /* A level indents by one caret and the gap after it — see the nested leaf below. */
    padding-inline-start: calc(
      var(--we-tree-indent, calc(16px + var(--we-space-200))) * var(--we-tree-level, 0) + var(--we-space-200)
    );
    border-radius: var(--we-theme-tree-radius, var(--we-radius-300));
    color: var(--we-role-text-muted);
    cursor: pointer;
    outline: none;
    min-height: var(--we-tree-row-height, 32px);
    box-sizing: border-box;
    position: relative;
  }
  [part='row']:hover {
    background: var(--we-role-item-hover);
    color: var(--we-role-text);
  }
  :host([selected]) [part='row'] {
    background: ${SELECTED('fill', 'var(--we-role-selected)')};
    color: ${SELECTED('text', 'var(--we-role-on-selected)')};
  }
  /* The leading bar, inside the row's own rounding on that side. */
  :host([selected]) [part='row']::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    width: ${SELECTED('border-width', '0px')};
    background: ${SELECTED('border', 'transparent')};
    border-start-start-radius: inherit;
    border-end-start-radius: inherit;
    pointer-events: none;
  }
  [part='row']:focus-visible {
    box-shadow: ${unsafeCSS(FOCUS_RING)};
  }
  [part='caret'] {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: var(--we-role-text-faint);
    transition: transform var(--we-transition-200, 150ms) ease;
  }
  :host([open]) [part='caret'] {
    transform: rotate(90deg);
  }
  /*
    A leaf at the top keeps the caret's space with nothing in it, so it lines up with the rows beside
    it that have one. Not the hidden attribute: the shared sheet makes that display: none !important,
    which takes the space away.
  */
  [part='caret'][data-leaf] {
    visibility: hidden;
    pointer-events: none;
  }
  /*
    A nested leaf has no caret at all, and its level's indent is that caret's width: so its glyph
    sits under its parent's glyph, and its label under its parent's label. A nested row with rows of
    its own keeps its caret there instead, and its own rows line up under it the same way.
  */
  [part='caret'][data-nested-leaf] {
    display: none;
  }
  [part='content'] {
    display: flex;
    align-items: center;
    gap: var(--we-space-200);
    flex: 1 1 auto;
    min-width: 0;
  }
`;

/**
 * One row of a `we-tree`, and the rows under it.
 *
 * The row's own content goes in the default slot — an icon, a label, a badge, a count, whatever the
 * template arranges (the kit's `treeRow` fragment is the usual one). Rows under it go in the
 * `children` slot, rendered only while it is open: a template that loads them lazily puts its query
 * inside an `$if` on the same open state, so nothing is read for a row nobody has opened.
 *
 * `open` is the template's to hold, as `selected` is the tree's: the row asks (`openchange`, `{ open }`,
 * bound as `onOpenChange`) and the template answers by setting it, so a row's open state can live in the address, in local
 * state or anywhere else.
 */
@customElement('we-tree-item')
export class TreeItem extends DesignSystemElement {
  static styles = [sharedStyles, ITEM_STYLES];

  static getDefaultProps() {
    return STACKED;
  }

  /** What `select` reports, and what the tree's `selected` is matched against. Unique within a tree. */
  @property({ type: String, reflect: true }) value = '';
  /** Whether the rows under it are shown. Set by the template, asked for with `openchange`. */
  @property({ type: Boolean, reflect: true }) open = false;
  /**
   * Whether it can have rows under it — shows the caret. Set it for a row whose children are not
   * loaded until it opens; otherwise the caret appears once there are children to show.
   */
  @property({ type: Boolean }) expandable = false;
  /** Set by the tree. */
  @property({ type: Boolean, reflect: true }) selected = false;
  /** Set by the tree: whether this row is the tree's one tab stop. */
  @property({ type: Boolean }) tabStop = false;
  /** Set by the tree: how deep the row is, for indentation and `aria-level`. */
  @property({ type: Number }) level = 0;

  /** Whether every row above this one is open, so this one is on screen. */
  isVisibleInTree(): boolean {
    let parent = this.parentItem();
    while (parent) {
      if (!parent.open) return false;
      parent = parent.parentItem();
    }
    return true;
  }

  depthInTree(): number {
    let depth = 0;
    let parent = this.parentItem();
    while (parent) {
      depth += 1;
      parent = parent.parentItem();
    }
    return depth;
  }

  parentItem(): TreeItem | null {
    return (this.parentElement?.closest('we-tree-item') as TreeItem | null) ?? null;
  }

  childItems(): TreeItem[] {
    return ([...this.querySelectorAll('we-tree-item')] as TreeItem[]).filter((item) => item.parentItem() === this);
  }

  firstChildItem(): TreeItem | undefined {
    return this.childItems()[0];
  }

  hasChildren(): boolean {
    return this.expandable || this.childItems().length > 0;
  }

  textLabel(): string {
    return (this.textContent ?? '').trim();
  }

  focusRow() {
    (this.shadowRoot?.querySelector('[part="row"]') as HTMLElement | null)?.focus();
  }

  /** Ask the template to open or close it. */
  setOpen(open: boolean) {
    this.dispatchEvent(new CustomEvent('openchange', { detail: { open }, bubbles: false }));
  }

  choose() {
    this.dispatchEvent(
      new CustomEvent('tree-item-select', { detail: { value: this.value }, bubbles: true, composed: true }),
    );
  }

  private onRowClick = (event: MouseEvent) => {
    /*
      A press on a control the row holds (a + , a menu) is that control's. Walked along the event's
      path rather than asked with `closest`, which stops at a shadow root: a press lands on the
      glyph inside a button's icon, two shadow roots below the button, and `closest` from there
      never reaches it — so the row chose itself as well, after the control had acted.
    */
    for (const node of event.composedPath()) {
      if (node === event.currentTarget) break;
      if (node instanceof Element && node.matches('button, a, we-button, we-icon-button, input')) return;
    }
    this.choose();
  };

  private onCaretClick = (event: MouseEvent) => {
    event.stopPropagation();
    this.setOpen(!this.open);
  };

  private onRowFocus = () => {
    this.dispatchEvent(
      new CustomEvent('tree-item-focus', { detail: { value: this.value }, bubbles: true, composed: true }),
    );
  };

  render() {
    const expandable = this.hasChildren();
    // One `base` part around the row and its children, as every primitive draws: it is the box the
    // design system lays out (the host is a flex row around it), so the default `direction` lands
    // here and the children stack under the row rather than beside it.
    return html`
      <div part="base">
        <div
          part="row"
          role="treeitem"
          tabindex=${this.tabStop ? '0' : '-1'}
          aria-level=${this.level + 1}
          aria-selected=${this.selected ? 'true' : 'false'}
          aria-expanded=${ifDefined(expandable ? (this.open ? 'true' : 'false') : undefined)}
          style=${`--we-tree-level: ${this.level}`}
          @click=${this.onRowClick}
          @focus=${this.onRowFocus}
        >
          <button
            part="caret"
            tabindex="-1"
            aria-hidden="true"
            ?data-leaf=${!expandable}
            ?data-nested-leaf=${!expandable && this.level > 0}
            @click=${this.onCaretClick}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M3 1.5 L7 5 L3 8.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <span part="content"><slot></slot></span>
        </div>
        ${this.open ? html`<div role="group" part="children"><slot name="children"></slot></div>` : ''}
      </div>
    `;
  }
}

export default Tree;
