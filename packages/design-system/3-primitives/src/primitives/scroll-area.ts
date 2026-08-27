import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

// overflow/scrollbarWidth/minWidth/minHeight go through DEFAULT_PROPS, not raw CSS —
// DesignSystemElement's generated stylesheet re-declares them on [part='base'] after
// this component's own styles load, silently reverting any hardcoded value to
// CSS-initial. See CONVENTIONS.md § "When to use CSS instead".
const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'block',
  overflow: 'auto',
  scrollbarWidth: 'thin',
  // Flex items default to min-size:auto (content-based) — without this, the host can
  // grow past its allotted flex space instead of clamping to it.
  minWidth: '0',
  minHeight: '0',
};

const styles = css`
  :host {
    /* Unlike other layout properties, :host's own overflow is NOT DS-managed (only
       [part='base']'s is — see CONVENTIONS.md), so it's safe and necessary to set
       directly here. Without it, oversized [part='base'] content spills out past the
       host instead of scrolling. */
    overflow: auto;
  }

  [part='base'] {
    scrollbar-color: var(--we-role-border-strong) transparent;
  }

  [part='base']::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  [part='base']::-webkit-scrollbar-track {
    background: transparent;
  }

  [part='base']::-webkit-scrollbar-thumb {
    background: var(--we-role-control-surface);
    border-radius: var(--we-radius-pill);
  }

  [part='base']::-webkit-scrollbar-thumb:hover {
    background: var(--we-role-border-strong);
  }
`;

/**
 * How close to the bottom still counts as "at the bottom", in pixels.
 *
 * Not zero, because it never is: fractional device pixels, a sub-pixel line height and a mid-flight
 * smooth scroll all leave `scrollTop` a hair short of the maximum, and an exact comparison would
 * read a reader who is plainly at the bottom as having scrolled away. Small enough that one line of
 * text is unambiguously "scrolled up".
 */
const AT_END_PX = 24;

@customElement('we-scroll-area')
export default class ScrollArea extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) maxHeight = '';
  @property({ type: String }) maxWidth = '';
  /**
   * Follow the end of the content as it grows — but only while the reader is already there.
   *
   * The behaviour every log-shaped list wants and none of them should implement twice: a transcript,
   * a chat, an activity feed. `'end'` turns it on; anything else leaves scrolling alone.
   *
   * The conditional half is the whole point. Pinning unconditionally yanks somebody out of what they
   * scrolled up to re-read, every time a new line lands — which in a live transcript is constantly,
   * and which is the one unforgivable bug in a log view. So the element remembers whether the reader
   * was at the end *before* the content changed, and only then follows.
   *
   * It reports nothing. A consumer wanting to offer "N new" while the reader is scrolled up needs an
   * event, and can have one when something actually renders that affordance — an event nobody
   * listens to is API that has to be kept working for nothing.
   */
  @property({ type: String }) pin: '' | 'end' = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  /** The scroller. Assigned on first render; `null` before then and after disconnect. */
  #base: HTMLElement | null = null;
  /** Whether the reader was at the end when we last looked. Seeded true so a fresh list starts pinned. */
  #atEnd = true;
  #mutations?: MutationObserver;
  #resize?: ResizeObserver;

  /**
   * Two observers, because content grows for two different reasons and only one of them is a
   * mutation.
   *
   * Rows arriving is a childList change on the *light* DOM — this element's own children, which are
   * slotted rather than owned, so the observer goes on the host. The host being resized (a panel
   * dragged shorter) changes what "the end" means without changing the content at all.
   *
   * Neither catches an image loading inside a row that was already there, which reflows without
   * mutating. Rows of text do not have that problem, and a log is rows of text; it is worth knowing
   * rather than worth a third observer.
   */
  connectedCallback(): void {
    super.connectedCallback();
    if (typeof MutationObserver !== 'undefined') {
      this.#mutations = new MutationObserver(() => this.#follow());
      this.#mutations.observe(this, { childList: true, subtree: true, characterData: true });
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.#resize = new ResizeObserver(() => this.#follow());
      this.#resize.observe(this);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#mutations?.disconnect();
    this.#resize?.disconnect();
    this.#mutations = undefined;
    this.#resize = undefined;
    this.#base = null;
  }

  firstUpdated(): void {
    this.#base = this.renderRoot.querySelector('[part="base"]');
    // A list that opens already scrolled to the bottom, rather than at the top of a backlog nobody
    // asked to re-read. Only when pinning is on: otherwise this would be a scroll nobody requested.
    if (this.pin === 'end') this.#toEnd();
  }

  /** Record where the reader is, so the next content change knows whether to follow them. */
  #onScroll = (): void => {
    const base = this.#base;
    if (!base) return;
    this.#atEnd = base.scrollHeight - base.scrollTop - base.clientHeight <= AT_END_PX;
  };

  #toEnd(): void {
    const base = this.#base;
    if (!base) return;
    // Instant, never smooth. A smooth scroll per arriving line queues animations that fight each
    // other, and the destination moves again before any of them lands.
    base.scrollTop = base.scrollHeight;
    this.#atEnd = true;
  }

  #follow(): void {
    if (this.pin !== 'end' || !this.#atEnd) return;
    this.#toEnd();
  }

  render() {
    const dynamicStyles: Record<string, string> = {};
    if (this.maxHeight) dynamicStyles['max-height'] = this.maxHeight;
    if (this.maxWidth) dynamicStyles['max-width'] = this.maxWidth;

    return html`
      <div part="base" style=${styleMap({ ...dynamicStyles, ...this.styles })} @scroll=${this.#onScroll}>
        <slot></slot>
      </div>
    `;
  }
}
