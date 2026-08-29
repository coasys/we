import { type DragItem, type DragPreview, dragSession, watchPointerDrag } from '@we/drag';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { LayoutElement } from '../shared/design-system-element';

const CSS_STYLES = css`
  :host {
    /* See "display: contents" in the class doc — the wrapper must not become a box. */
    --we-draggable-host-display: contents;
    display: contents;
    /*
      Vertical panning still works, so a finger can scroll a feed of draggable cards. The drag is a
      long press instead — touch-action: none here would be the same bug the sortable's touch
      handling exists to avoid, one level up: a list you cannot scroll.
    */
    touch-action: pan-y;
  }

  :host([disabled]) {
    touch-action: auto;
  }
`;

/**
 * Makes whatever is inside it something that can be picked up and carried somewhere else.
 *
 * ## Why this exists as a primitive
 *
 * A post card, a member row and a space in the sidebar are rendered by **templates**, which are
 * data. If making one draggable were a code change, every future draggable surface would be a code
 * change too, and the contribution ladder says arrangement stays data. This is the same rung
 * `we-sortable` occupies: two custom elements and an existing `$action`, with no new prop resolver,
 * no new operator, and nothing added to the expression grammar.
 *
 * ```json
 * { "type": "we-draggable",
 *   "props": { "entity": "CollectionBlock", "recordId": { "$": "post.id" }, "label": { "$": "post.title" } },
 *   "children": [ "…the card…" ] }
 * ```
 *
 * ## What it carries
 *
 * A **reference** — `{ dataset?, entity, id }` — never DOM, and never the row object. `dataset` is
 * deliberately left empty here: a card fragment cannot name its own dataset without reading a
 * store, and portable fragments name no store by construction. The receiver stamps it, from
 * whichever dataset was current when the drop happened.
 *
 * ## `display: contents`
 *
 * The wrapper must not exist as a box. A card inside a grid track, a row inside a flex column: a
 * real element in between would take the track and leave the card laid out against the wrapper
 * instead of the grid. What is dragged is therefore the *child*, which is also what the ghost and
 * the geometry are measured from.
 *
 * @fires we-drag-begin - detail: the DragItem, when a drag actually starts (not on the press)
 */
@customElement('we-draggable')
export default class Draggable extends LayoutElement {
  static styles = [CSS_STYLES];

  /** The model name the reference points at — `CollectionBlock`, `Space`, `Agent`. */
  @property({ type: String, reflect: true }) entity = '';

  /** The record's id within its dataset. A DID, where the entity is an agent. */
  @property({ type: String, reflect: true }) recordId = '';

  /**
   * Which dataset holds it. **Leave this empty for anything in the space on screen** — the receiver
   * stamps it, and that is the ordinary case.
   *
   * Set it only where the source knows the answer and the receiver would get it wrong: a row in the
   * Pocket panel came from somewhere else entirely, so dragging it out and letting the receiver
   * assume "wherever we are now" would rewrite what the row points at. The value is opaque here —
   * the design system does not know what a dataset is, and must not have to.
   */
  @property({ type: String }) datasetKey = '';

  /** What the ghost says, and what a receiver writes down. */
  @property({ type: String }) label = '';

  /** A Phosphor name for the ghost. */
  @property({ type: String }) icon = '';

  /**
   * What this row was drawn with — `{ thumbnail?, content?, author?, date? }` — so the ghost can
   * draw the same card and a receiver can keep it.
   *
   * **`attribute: false`**, unlike every other prop here. The others are short strings and reflect
   * usefully; this is an object holding, for a post, the whole composed document. Serialising that
   * into an attribute on every card in a feed would put a copy of each post in the DOM to support a
   * gesture almost none of them will receive. As a property it is a reference to a string the row
   * already holds, which costs nothing until something is actually picked up.
   */
  @property({ attribute: false }) preview?: DragPreview;

  /**
   * The source's own handle on this row, for a receiver that can *move* it rather than copy it.
   *
   * Opaque to the session and to every zone that does not recognise it — which is the point: a
   * Pocket row carries its own record id and the folder it is sitting in, and only the Pocket knows
   * what to do with that. Anything else keeps treating the drop as a copy.
   *
   * `attribute: false`, like `preview`: it is an object, and it means nothing outside the pair of
   * surfaces that agreed on it.
   */
  @property({ attribute: false }) origin?: unknown;

  /**
   * What the drop means to *this* end. `copy` (the default) is what gathering is: the thing stays
   * where it was.
   */
  @property({ type: String }) effect: 'move' | 'copy' | 'link' = 'copy';

  /** Refuse to be picked up. For a row that is a placeholder, or one still saving. */
  @property({ type: Boolean, reflect: true }) disabled = false;

  private _stopWatch: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerdown', this._onPointerDown);
    this.addEventListener('keydown', this._onKeyDown);
  }

  firstUpdated() {
    // The host has no box (`display: contents`) and so cannot hold focus. The child can, and a
    // keydown on it bubbles here — which is the whole keyboard path. Done for the consumer rather
    // than asked of them, since an unfocusable card is one nobody can gather without a mouse.
    this._markFocusable();
    this.shadowRoot?.querySelector('slot')?.addEventListener('slotchange', () => this._markFocusable());
  }

  private _markFocusable() {
    for (const child of this.shadowRoot?.querySelector('slot')?.assignedElements() ?? []) {
      const target = child.hasAttribute('data-we-id') ? child : (child.querySelector('[data-we-id]') ?? child);
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '0');
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerdown', this._onPointerDown);
    this.removeEventListener('keydown', this._onKeyDown);
    this._stopWatch?.();
    this._stopWatch = null;
  }

  /** Nothing to carry without both halves of the reference. */
  private get _ready(): boolean {
    return !this.disabled && !!this.entity && !!this.recordId;
  }

  private _item(): DragItem {
    return {
      ref: { entity: this.entity, id: this.recordId, ...(this.datasetKey && { dataset: this.datasetKey }) },
      label: this.label || this.entity,
      ...(this.icon && { icon: this.icon }),
      ...(this._preview() && { preview: this._preview() }),
      ...(this.origin !== undefined && { origin: this.origin }),
    };
  }

  /**
   * The preview, with empty fields dropped.
   *
   * A schema fills the bag from row properties, and a row that has no picture supplies `''` rather
   * than omitting the key — so without this every item would carry `{ thumbnail: '' }` and a
   * receiver testing for the key would believe there was one.
   */
  private _preview(): DragPreview | undefined {
    const entries = Object.entries(this.preview ?? {}).filter(([, value]) => !!value);
    return entries.length ? (Object.fromEntries(entries) as DragPreview) : undefined;
  }

  private _onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !this._ready) return;
    // A press that begins inside a control belongs to that control. Without this, dragging to
    // select the text of a card's title would pick the card up, and a card holding a button could
    // not be clicked without a steady hand.
    if (e.composedPath().some((node) => this._isInteractive(node))) return;
    if (dragSession.isClaimed(e)) return;
    dragSession.claimPress(e);

    this._stopWatch = watchPointerDrag(e, {
      capture: this,
      onStart: (start) => {
        dragSession.begin({
          payload: { items: [this._item()], effect: this.effect },
          pointer: { x: start.clientX, y: start.clientY },
          from: this,
        });
        this.dispatchEvent(new CustomEvent('we-drag-begin', { detail: this._item(), bubbles: true, composed: true }));
      },
      onMove: (move) => dragSession.move({ x: move.clientX, y: move.clientY }),
      onEnd: (end) => dragSession.drop({ x: end.clientX, y: end.clientY }),
      onCancel: () => dragSession.cancel(),
    });
  };

  /**
   * The keyboard path: Space or Enter picks up, the arrow keys choose a zone, Space drops, Escape
   * cancels — which the session handles.
   *
   * Built in rather than added later, for the reason `we-sortable`'s is: a panel that can only be
   * filled by dragging is a panel some people cannot fill at all. It is also the path a touchscreen
   * falls back on, since a drag across a phone-sized screen into a full-bleed sheet is not a
   * gesture anybody can make.
   */
  private _onKeyDown = (e: KeyboardEvent) => {
    if (!this._ready) return;
    if (e.key === ' ' || e.key === 'Enter') {
      // A space typed into a field is typing, never a pickup — the same rule `we-sortable` learned.
      if (e.composedPath().some((node) => this._isTextEntry(node))) return;
      if (dragSession.keyboardActive()) dragSession.dropKeyboard();
      else dragSession.beginKeyboard({ items: [this._item()], effect: this.effect }, this);
      e.preventDefault();
      return;
    }
    if (!dragSession.keyboardActive()) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      dragSession.cycleKeyboard(1);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      dragSession.cycleKeyboard(-1);
      e.preventDefault();
    }
  };

  private _isInteractive(node: EventTarget): boolean {
    if (!(node instanceof Element)) return false;
    if (this._isTextEntry(node)) return true;
    const tag = node.tagName.toLowerCase();
    return tag === 'button' || tag === 'a' || tag === 'we-button' || tag === 'we-link' || tag === 'we-select';
  }

  private _isTextEntry(node: EventTarget): boolean {
    if (!(node instanceof HTMLElement)) return false;
    return (
      node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable
    );
  }

  render() {
    return html`<slot></slot>`;
  }
}
