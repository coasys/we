import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { scrollbarRules } from '@we/tokens';
import { css, html, nothing, type PropertyValues, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DEV_BUILD } from '../shared/boxless';
import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

// overflow/minWidth/minHeight go through DEFAULT_PROPS, not raw CSS —
// DesignSystemElement's generated stylesheet re-declares them on [part='base'] after
// this component's own styles load, silently reverting any hardcoded value to
// CSS-initial. See CONVENTIONS.md § "When to use CSS instead".
const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'block',
  overflow: 'auto',
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

  /*
    The shared ruleset, rather than this component's own copy of it.

    The copy was three kinds of wrong at once, and the component named for scrolling was the only
    place any of them showed. It hardcoded 6px instead of reading the scrollbar width token, so a
    theme changing that width moved every scroll region except this one. It restated the thumb
    colour and radius as literals rather than tokens. And — the reason none of that mattered — it
    also set scrollbar-color here and scrollbarWidth thin in DEFAULT_PROPS, either of which makes
    Chromium ignore every webkit scrollbar rule on the element and draw the platform's own bar
    instead. So all twenty lines below were dead code, and this rendered the OS scrollbar: a
    different colour from the rest of the app, a different shape, and on Linux the stepper arrows
    the GTK theme draws. The pocket panel is where that was noticed.

    scrollbarRules carries the button suppression too, which this copy also lacked — so fixing only
    the opt-out would have swapped the platform's arrows for Chromium's own.
  */
  ${unsafeCSS(scrollbarRules("[part='base']"))}

  /*
    The jump controls sit over the content rather than beside it, so turning them on cannot reflow
    what is being read. Positioning lives on a plain wrapper rather than on the button itself: a
    part other than :host or [part='base'] is not touched by the generated stylesheet (see
    CONVENTIONS.md), and a wrapper keeps this component's CSS out of we-button's own cascade
    entirely. The host is what they are positioned against — see getInstanceProps.
  */
  [part='jump-start'],
  [part='jump-end'] {
    position: absolute;
    right: var(--we-space-300);
    display: flex;
    z-index: 1;
  }

  [part='jump-start'] {
    top: var(--we-space-300);
  }

  [part='jump-end'] {
    bottom: var(--we-space-300);
  }

  /*
    Pinning, done by the browser rather than by us.

    column-reverse makes the scroller's origin its BOTTOM: the resting position is the newest
    content, and the browser holds it there through anything — rows reflowing taller as profiles and
    avatars resolve, a font swapping, a whole page of content replacing another. Measured in Chrome:
    tripling every row's height left the newest row still in view, with no script running at all.

    This replaces about a hundred and fifty lines that tried to do the same by writing scrollTop, and
    could not. The reason they could not is worth keeping: to chase the end you must know when the
    content has stopped changing, and nothing can tell you. A MutationObserver is blind to reflow, a
    ResizeObserver on the host is blind to the content, and the one mechanism that does see
    everything — the browser's own scroll anchoring — was FIGHTING the chase rather than helping it.

    Measured on a real transcript: the code jumped to the bottom, the rows then grew 2114px as their
    bylines arrived, the browser shifted scrollTop by 2006px to keep the reader's place, our scroll
    handler read that as the reader scrolling away, and the list unpinned itself 108px short of the
    end for good. Every part of that is correct behaviour by two systems that should never both have
    been running.

    overflow-anchor: none is the other half: with the origin at the bottom there is nothing for
    anchoring to do, and leaving it on re-opens exactly the fight described above.
  */
  :host([pin='end']) [part='base'] {
    display: flex;
    flex-direction: column-reverse;
    overflow-anchor: none;
  }

  /*
    One flex item, so the reversal does not reach the content.

    column-reverse reverses the order of its *items*, which would otherwise mean every consumer of a
    pinned list having to pass its children backwards — a contract that is invisible when broken and
    that anything composing fragments would get wrong sooner or later. Collapsing the slot into a
    single item means the reversal applies to that one box and the content inside it lays out
    normally, in the order it was written. Measured: rows in ordinary oldest-first order, drawn in
    the right order, resting at the newest end.

    display: contents unless pinned, so an unpinned scroll area is laid out exactly as it was before
    this box existed — it generates no box of its own and its children go on being the scroller's.
  */
  [part='content'] {
    display: contents;
  }

  :host([pin='end']) [part='content'] {
    display: block;
  }
`;

/**
 * How close to the bottom still counts as "at the bottom", in pixels.
 *
 * Not zero, because it never is: fractional device pixels, a sub-pixel line height and a mid-flight
 * smooth scroll all leave a scroller a hair short of either end, and an exact comparison would read
 * somebody plainly at the bottom as being somewhere else. Small enough that one line of text is
 * unambiguously "scrolled up".
 *
 * Used against the distance from an end rather than against `scrollTop`, so it means the same thing
 * whichever way round the scroller is — see `#fromEnd`.
 */
const AT_END_PX = 24;

/** Instance counter for the temporary diagnostic below. Module-level so it stays out of the CEM. */
let probeSeq = 0;

/** Whether the reader has asked for less movement. Absent in a non-browser environment. */
function prefersReducedMotion(): boolean {
  const query = globalThis.matchMedia;
  return typeof query === 'function' && query('(prefers-reduced-motion: reduce)').matches;
}

@customElement('we-scroll-area')
export default class ScrollArea extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) maxHeight = '';
  @property({ type: String }) maxWidth = '';
  /**
   * A log-shaped list: the newest content is at the bottom, and that is where the reader starts.
   *
   * What every one of these wants and none of them should implement twice — a transcript, a chat, an
   * activity feed. `'end'` turns it on; anything else leaves scrolling alone.
   *
   * ## Nothing about the content changes
   *
   * Children stay in ordinary reading order, oldest first, however many of them there are. The
   * reversal is `flex-direction: column-reverse` on the scroller and it reaches exactly one box —
   * see the `[part='content']` rule — so it moves the scroll *origin* to the bottom without touching
   * the order anything is drawn in. A contract that said "pass your children backwards" would be
   * invisible when broken and would be broken by the first fragment that composed two lists.
   *
   * ## What that buys, and what it replaces
   *
   * The resting position is the bottom, from the first frame, with no script. The browser then holds
   * it there through anything: rows reflowing taller as their bylines arrive, a font swapping, one
   * call's transcript replacing another's. Older content loaded in above does not move the reader
   * either, which is infinite-scroll-upwards for free.
   *
   * None of that was reachable by writing `scrollTop`, and the reason is worth stating once: to
   * chase the end you have to know when the content has stopped changing, and nothing can tell you
   * — see the note beside the `:host([pin='end'])` rule for what that cost in practice.
   *
   * ## Scroll coordinates are inverted here
   *
   * `scrollTop` runs from `-(scrollHeight - clientHeight)` at the oldest end to `0` at the newest,
   * rather than `0`..max. Measured, not assumed. Nothing outside this element should care — the
   * helpers below speak in distance-from-each-end — but a consumer reading `scrollTop` directly will
   * find it negative.
   *
   * It reports nothing about arriving content. `jump` covers the affordance a reader needs; a
   * consumer wanting to say *how much* they missed ("3 new") needs an event, and can have one when
   * something actually renders that.
   */
  @property({ type: String, reflect: true }) pin: '' | 'end' = '';
  /**
   * Offer a button back to the start of the content, to the end of it, or both.
   *
   * The affordance a long scroll region needs and a schema cannot write for itself: a button that
   * knows where the scroller is has to be measured, and measuring is what a primitive is for. Each
   * one is shown only when it would go somewhere — no button at the end you are already at — so
   * `'both'` on a short list draws nothing at all.
   *
   * `'end'` also re-arms `pin`, which is the useful half in a live list: a reader who scrolled up
   * to re-read something presses it once and goes back to being carried along.
   */
  @property({ type: String }) jump: '' | 'start' | 'end' | 'both' = '';
  /**
   * Say when the reader comes within this many pixels of the start, so a list can load what is
   * before it — infinite scroll, upwards.
   *
   * Opt-in, and a distance rather than a flag, because the right distance is the consumer's
   * question: it is how far ahead of the reader a page has to be fetched to arrive before they get
   * there, which depends on how big a page is and how slow the backend is. `0` is off, and off is
   * the default — an event nobody listens to is API kept working for nothing.
   *
   * It fires `nearstart`, once per approach: sitting at the top does not repeat it, and scrolling
   * away past the threshold re-arms it. So a consumer's handler is "fetch the next page", not "fetch
   * the next page if I am not already fetching one".
   *
   * ## It holds the reader's place across what arrives
   *
   * Loading earlier content puts it *above* what is on screen, which moves everything the reader is
   * looking at down by the height of the new rows — so without this, asking for more is punished by
   * losing your place, repeatedly, while scrolling. After firing, the scroller remembers its distance
   * from the *bottom* and restores it when the content next grows, which is exactly right for a
   * prepend and needs no cooperation from the consumer.
   *
   * Distance from the bottom rather than an anchor element on purpose: a list re-rendered from a
   * re-run query rebuilds every row, so there is no node whose identity survives the growth to
   * anchor to. The bottom is the one edge that does not move when content is added above it.
   */
  @property({ type: Number }) nearStart = 0;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  /** Whether each control would currently go anywhere. Reactive, so growth reveals them. */
  @state() private _showStart = false;
  @state() private _showEnd = false;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  /**
   * The host is the containing block for the jump controls, and only then.
   *
   * `position` is DS-covered on `:host`, so hardcoding it in `static styles` would be reverted the
   * moment an instance rendered — it has to come through the prop merge. It is added per instance
   * rather than in `DEFAULT_PROPS` because a stacking context is not free: an ordinary scroll area
   * has no reason to become one, and something absolutely positioned in slotted content would
   * quietly start resolving against it.
   */
  override getInstanceProps(): Partial<DesignSystemProps> {
    const ctor = this.constructor as typeof ScrollArea & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const defaults = this.jump ? { ...DEFAULT_PROPS, position: 'relative' as const } : DEFAULT_PROPS;
    return mergeProps(usedProps, defaults) as Partial<DesignSystemProps>;
  }

  /** The scroller. Assigned on first render; `null` before then and after disconnect. */
  #base: HTMLElement | null = null;
  /** Whether the reader is currently inside the `nearStart` threshold, so it fires once per approach. */
  #nearStart = false;
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
   * rather than worth a third observer. The settle pass in `#followUntilSettled` covers the near
   * case — content that keeps growing for a few frames after the mutation, which a page of custom
   * elements rendering their own shadow content does — so what is left uncovered is a reflow
   * arriving later than that, and following it would mean yanking the view for something the reader
   * has by then been looking at.
   */
  /**
   * Two observers, and they no longer decide anything about position.
   *
   * Pinning is the browser's, so what is left for these is keeping the jump controls honest and
   * noticing when the reader has come within reach of the start: both are questions about where the
   * scroller is *now*, which changes when content does. They used to drive a follow, which is what
   * made their blind spots matter — a `MutationObserver` cannot see a reflow and a `ResizeObserver`
   * on the host cannot see the content. Neither gap costs anything here: the worst case is a jump
   * button appearing a moment late.
   */
  connectedCallback(): void {
    super.connectedCallback();
    if (typeof MutationObserver !== 'undefined') {
      this.#mutations = new MutationObserver(() => this.#contentChanged());
      this.#mutations.observe(this, { childList: true, subtree: true, characterData: true });
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.#resize = new ResizeObserver(() => this.#contentChanged());
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
    // No opening scroll. A pinned list is `column-reverse`, so its resting position IS the newest
    // content — there is nothing to move it to, from the first frame, and nothing to get wrong.
    this.#syncControls();
    this.#startProbe();
  }

  /** `jump` arrives as a DOM property and its controls cannot be measured before there is a scroller. */
  updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('pin') || changed.has('jump')) this.#syncControls();
  }

  /*
    ── TEMPORARY DIAGNOSTIC ─────────────────────────────────────────────────────────────────────

    Kept only until the column-reverse change is confirmed against a real transcript, then deleted.
    It is what found the fault: chasing the end could not be reasoned about from a synthetic harness,
    and the log from the app is what showed the browser's scroll anchoring moving the scroller 2006px
    and the element reading that as the reader.

    `localStorage.setItem('we:scroll-probe', '1')` and reload, on any build.
  */
  #probeStart = 0;
  #probeTag = '';
  #probeHeight = -1;
  #probeTimers: ReturnType<typeof setTimeout>[] = [];

  #probeOn(): boolean {
    if (DEV_BUILD) return true;
    try {
      return globalThis.localStorage?.getItem('we:scroll-probe') === '1';
    } catch {
      return false;
    }
  }

  #startProbe(): void {
    if (!this.#probeOn() || this.pin !== 'end' || this.#probeTag) return;
    this.#probeTag = `sa${++probeSeq}`;
    this.#probeWatch('mounted');
  }

  /** Restart the clock and a round of samples whenever the content is replaced wholesale. */
  #probeWatch(what: string): void {
    const base = this.#base;
    if (!this.#probeTag || !base) return;
    const height = base.scrollHeight;
    const replaced = this.#probeHeight < 0 || Math.abs(height - this.#probeHeight) >= base.clientHeight;
    this.#probeHeight = height;

    if (replaced) {
      this.#probeStart = Date.now();
      for (const timer of this.#probeTimers) clearTimeout(timer);
      this.#probeTimers = [100, 300, 600, 1000, 2000, 4000].map((at) =>
        setTimeout(() => this.#probe(`sample${at}`), at),
      );
    }
    this.#probe(replaced ? `${what}*RESET` : what);
  }

  #probe(what: string): void {
    const base = this.#base;
    if (!this.#probeTag || !base) return;
    const text = (this.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28);
    console.log(
      `[scroll-probe ${this.#probeTag}] +${String(Date.now() - this.#probeStart).padStart(5)}ms ${what.padEnd(10)}` +
        ` h=${base.scrollHeight} c=${base.clientHeight} top=${Math.round(base.scrollTop)}` +
        ` fromEnd=${Math.round(this.#fromEnd())} fromStart=${Math.round(this.#fromStart())} | ${text}`,
    );
  }

  /*
    ── Position, in the one place that knows which way round the scroller is ────────────────────

    Under `pin='end'` the scroller is `column-reverse`, and `scrollTop` runs from
    `-(scrollHeight - clientHeight)` at the oldest content to `0` at the newest — measured in Chrome
    rather than assumed, because it is the opposite of the ordinary arrangement and everything that
    reads a scroll position would be quietly backwards.

    So nothing below reads `scrollTop`. Everything asks how far the reader is from one end or the
    other, and these four are the only places the direction is known.
  */

  /** The travel available, in pixels. Zero when nothing overflows. */
  #span(): number {
    const base = this.#base;
    return base ? Math.max(0, base.scrollHeight - base.clientHeight) : 0;
  }

  /** How far the reader is from the newest end. Zero at it. */
  #fromEnd(): number {
    const base = this.#base;
    if (!base) return 0;
    return this.pin === 'end' ? -base.scrollTop : this.#span() - base.scrollTop;
  }

  /** How far the reader is from the oldest end. Zero at it. */
  #fromStart(): number {
    const base = this.#base;
    if (!base) return 0;
    return this.pin === 'end' ? this.#span() + base.scrollTop : base.scrollTop;
  }

  /** The `scrollTop` of each end. */
  #endTop(): number {
    return this.pin === 'end' ? 0 : this.#span();
  }
  #startTop(): number {
    return this.pin === 'end' ? -this.#span() : 0;
  }

  /**
   * Go somewhere, animating unless the reader has asked not to.
   *
   * Only ever called by a jump control now, which is why there is no distance cap left: the old one
   * existed to tell a *follow* worth animating from a backlog landing at once, and follows are gone.
   * Somebody who presses "jump to the end" has asked to travel, and the distance is the reason they
   * pressed it.
   */
  #scrollTo(top: number): void {
    const base = this.#base;
    if (!base) return;
    if (typeof base.scrollTo === 'function' && !prefersReducedMotion()) {
      base.scrollTo({ top, behavior: 'smooth' });
      return;
    }
    base.scrollTop = top;
  }

  /**
   * Say when the reader has come within reach of the start, once per approach.
   *
   * Latched, so sitting at the top does not fire it on every frame of a rubber-band and a consumer's
   * handler can be the plain "fetch the next page". Scrolling back out past the threshold re-arms it.
   *
   * There is no place to hold any more. Under `column-reverse` the scroll position is measured from
   * the bottom, so content loaded in above the reader does not move them — the thing the earlier
   * implementation spent a `#holdBottom`, a deadline and a restore pass on is simply how the box
   * behaves.
   */
  #checkNearStart(): void {
    if (!this.nearStart || this.#span() <= AT_END_PX) return;

    const near = this.#fromStart() <= this.nearStart;
    if (near === this.#nearStart) return;
    this.#nearStart = near;
    if (!near) return;

    this.dispatchEvent(new CustomEvent('nearstart', { bubbles: true, composed: true }));
  }

  #onScrolled = (): void => {
    this.#checkNearStart();
    this.#syncControls();
  };

  #contentChanged(): void {
    this.#probeWatch('content');
    this.#checkNearStart();
    this.#syncControls();
  }

  /**
   * Whether each jump control would currently go anywhere.
   *
   * Measured rather than inferred, and re-measured whenever the content changes as well as whenever
   * the scroller moves — a list growing past the reader is exactly when "jump to the end" becomes
   * worth offering, and nobody has scrolled at that moment.
   */
  #syncControls(): void {
    if (!this.#base || !this.jump) {
      this._showStart = false;
      this._showEnd = false;
      return;
    }

    // Nothing worth jumping across: an ordinary short list should draw no chrome at all.
    const scrollable = this.#span() > AT_END_PX;
    const offers = (which: 'start' | 'end') => this.jump === which || this.jump === 'both';

    this._showStart = scrollable && offers('start') && this.#fromStart() > AT_END_PX;
    this._showEnd = scrollable && offers('end') && this.#fromEnd() > AT_END_PX;
  }

  #onJumpStart = (): void => this.#scrollTo(this.#startTop());

  #onJumpEnd = (): void => {
    this.#scrollTo(this.#endTop());
    this.#syncControls();
  };

  render() {
    const dynamicStyles: Record<string, string> = {};
    if (this.maxHeight) dynamicStyles['max-height'] = this.maxHeight;
    if (this.maxWidth) dynamicStyles['max-width'] = this.maxWidth;

    return html`
      <div part="base" style=${styleMap({ ...dynamicStyles, ...this.styles })} @scroll=${this.#onScrolled}>
        <div part="content"><slot></slot></div>
      </div>
      ${
        /*
          The start control, or whatever a consumer puts in its place.

          The slot is here because "back to the start" is not always a scroll. A windowed list — a
          transcript that loads the newest page first — has a top of *what is loaded*, which is not
          the beginning of anything; pressing a scroll-to-top there would say "start" and deliver "as
          far back as we happened to fetch". Reaching the real beginning is a different query, and
          only the consumer can run it.

          So the primitive keeps what it is actually expert in — where the control sits, over the
          content and clear of the scrollbar, and *whether there is anywhere to go* — and hands back
          only the part it cannot answer, which is what pressing it should do. Slotted content is
          gated by `_showStart` exactly as the built-in button is, so a consumer opts in with
          `jump="start"` (or `"both"`) and replaces the action, not the visibility.

          No `jump-end` twin. Nothing needs one, and the case is weaker — the end of what is loaded
          IS the end of a list that grows at the bottom, so the built-in control is already honest
          there.
        */
        this._showStart
          ? html`
              <div part="jump-start">
                <slot name="jump-start">
                  <we-button
                    variant="secondary"
                    size="sm"
                    square
                    r="pill"
                    shadow="md"
                    label="Jump to the start"
                    @click=${this.#onJumpStart}
                  >
                    <we-icon name="caret-double-up"></we-icon>
                  </we-button>
                </slot>
              </div>
            `
          : nothing
      }
      ${
        this._showEnd
          ? html`
              <div part="jump-end">
                <we-button
                  variant="secondary"
                  size="sm"
                  square
                  r="pill"
                  shadow="md"
                  label="Jump to the end"
                  @click=${this.#onJumpEnd}
                >
                  <we-icon name="caret-double-down"></we-icon>
                </we-button>
              </div>
            `
          : nothing
      }
    `;
  }
}
