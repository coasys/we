import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { scrollbarRules } from '@we/tokens';
import { css, html, nothing, type PropertyValues, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

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

/**
 * How far behind the end a follow may be and still be worth animating, in pixels.
 *
 * A smooth scroll earns its place by saying *which way* the content moved — a line arrived below,
 * rather than the view jumping to somewhere unrecognisable. It stops earning it once the journey is
 * longer than anybody would sit through: a backlog landing at once, a list re-subscribing, a call's
 * history arriving. Those are a change of place, not a movement, and a jump is the honest rendering.
 */
const SMOOTH_MAX_PX = 1200;

/**
 * How long a follow keeps re-checking that the end has stopped moving, in milliseconds.
 *
 * One frame is a fixed budget and content is not. A page of rows arriving at once is a hundred-odd
 * custom elements each rendering their own shadow content, and on a slower machine, a wider panel or
 * a longer page that does not finish inside a single frame — so the follow measured a list mid-layout
 * and landed short of a bottom that kept moving. That is the "two lines still hidden under the edge"
 * a reader then has to scroll for by hand.
 *
 * Bounded by time rather than by a frame count so the cost is the same whatever the frame rate, and
 * it stops the moment two consecutive frames agree. Nothing spins for this long in practice: a list
 * that has settled settles in two frames.
 */
const SETTLE_MS = 600;

/**
 * How long after asking for earlier content the scroller will hold the reader's place, in
 * milliseconds.
 *
 * Long enough to cover a round trip to a remote node, short enough that a page arriving after the
 * reader has given up and scrolled elsewhere does not move them. See `#holdBottom`.
 */
const HOLD_MS = 4_000;

/**
 * Gestures that mean the reader has taken the scroller back.
 *
 * `keydown` is in the list for the same reason the others are — Page Down and End scroll — and
 * costs nothing when the key was a letter: the flag it clears is re-set by the next follow.
 */
const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
const USER_INPUT_OPTIONS = { capture: true, passive: true } as const;

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
   * Following animates, so the eye can tell a line arriving below from the view jumping somewhere
   * else. The opening jump does not — there is nothing to have moved from — and neither does a
   * catch-up longer than `SMOOTH_MAX_PX`, nor one for a reader who has asked for reduced motion.
   * A `jump` press is not subject to that cap: it is a request to travel, and the distance is the
   * reason it was pressed.
   *
   * It reports nothing. `jump` covers the affordance a reader needs — a way back to the end — but a
   * consumer wanting to say *how much* they missed ("3 new") needs an event, and can have one when
   * something actually renders that: an event nobody listens to is API kept working for nothing.
   */
  @property({ type: String }) pin: '' | 'end' = '';
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
  /** Whether the reader was at the end when we last looked. Seeded true so a fresh list starts pinned. */
  #atEnd = true;
  /**
   * Where our own last instant scroll left the scroller, read back after the write so it holds the
   * value the browser actually clamped to. A scroll event reporting exactly this position is our
   * own and says nothing about the reader — see `#onScroll`.
   */
  #writtenTop = -1;
  /** A smooth follow we started is still animating; its frames are ours, not the reader's. */
  #following = false;
  /**
   * The opening is **over** — the list has reached its end and stopped moving — so later follows may
   * animate.
   *
   * It used to mean "we have scrolled at least once", set in `#toEnd` before its own early return,
   * and that was wrong twice over. The contentless call from `firstUpdated` set it, and an opening
   * is not one scroll anyway: the content mounts, is measured, is replaced, and settles at a
   * different height, with the scroller reset to zero in between. Measured on a twenty-line
   * transcript, opening was `instant 0→720`, then `smooth 0→412`, then `smooth 0→412` — so what the
   * reader saw was the list sliding up from the top, arriving a few hundred milliseconds after the
   * panel did, with the last lines under the edge until it got there.
   *
   * Set from the settle pass instead, which is the one place that knows the content has stopped
   * changing. Everything up to that point is the opening and is instant however far it travels;
   * everything after it animates however short it is. That is the rule as a reader states it — a
   * list opens already in the right place, and *moves* only in response to something happening —
   * and it is not expressible as a distance, which is what the earlier attempt at this got wrong.
   */
  #opened = false;
  /** A pending follow, scheduled for after layout. */
  #frame = 0;
  /** When the current settle pass gives up, as a timestamp. Zero when none is running. */
  #settleUntil = 0;
  /** The scroll height the last settle frame saw, so a frame that changed nothing can stop. */
  #settleHeight = -1;
  /**
   * The distance from the bottom to restore when content next grows, or `-1` for none.
   *
   * Armed when `nearstart` fires and the consumer is therefore about to prepend. See `nearStart`.
   */
  #holdBottom = -1;
  /** When that hold expires, as a timestamp. */
  #holdUntil = 0;
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
    // A reader touching the element takes the scroller back off us: whatever we had in flight stops
    // being ours, and the scroll it produces is judged as theirs.
    for (const type of USER_INPUT_EVENTS) this.addEventListener(type, this.#onUserInput, USER_INPUT_OPTIONS);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#mutations?.disconnect();
    this.#resize?.disconnect();
    for (const type of USER_INPUT_EVENTS) this.removeEventListener(type, this.#onUserInput, USER_INPUT_OPTIONS);
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#following = false;
    this.#mutations = undefined;
    this.#resize = undefined;
    this.#base = null;
  }

  firstUpdated(): void {
    this.#base = this.renderRoot.querySelector('[part="base"]');
    // A list that opens already scrolled to the bottom, rather than at the top of a backlog nobody
    // asked to re-read. Only when pinning is on: otherwise this would be a scroll nobody requested.
    if (this.pin === 'end') this.#toEnd({ smooth: false });
    this.#syncControls();
  }

  /**
   * `pin` is set as a DOM property, and a framework binding it inside an effect can do so *after*
   * Lit has rendered — in which case `firstUpdated` above ran while pinning was still off and the
   * opening jump never happened, leaving the list at the top of its backlog. `jump` arrives the
   * same way, and its controls cannot be measured before there is a scroller to measure.
   */
  updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('pin') && this.pin === 'end' && !this.#opened) this.#toEnd({ smooth: false });
    if (changed.has('pin') || changed.has('jump')) this.#syncControls();
  }

  /**
   * Decide, from where the scroller has just landed, whether the reader still wants the end.
   *
   * The subtlety is that not every scroll event is the reader. Content growing under a stationary
   * `scrollTop` moves the end away without anybody moving at all, and the event our own follow
   * queues is delivered in the frame's scroll steps — *after* the microtask that wrote it, and so
   * after anything rendered asynchronously in between has made the content taller than it was when
   * we measured. Reading either of those as "scrolled away" is what used to unpin a transcript
   * permanently the first time somebody said more than one line's worth: the latch went false and
   * nothing but a manual scroll back to the bottom could ever set it true again.
   *
   * So a scroll only counts as the reader's when it is neither a frame of our own animation nor a
   * landing at the exact position we last wrote.
   */
  #onScroll = (): void => {
    const base = this.#base;
    if (!base) return;

    const top = base.scrollTop;
    const distance = base.scrollHeight - top - base.clientHeight;

    if (this.#following) {
      // Ours until it arrives. A reader who interrupts it has already cleared the flag by touching
      // the element, so their scroll is judged below rather than swallowed here.
      if (distance <= AT_END_PX) this.#following = false;
      return;
    }

    // Landing at the end re-arms following, however the reader got there.
    if (distance <= AT_END_PX) {
      this.#atEnd = true;
      return;
    }

    if (top === this.#writtenTop) return;
    this.#atEnd = false;
  };

  /**
   * Say when the reader has come within reach of the start, once per approach.
   *
   * Latched, so sitting at the top does not fire it on every frame of a rubber-band and a consumer's
   * handler can be the plain "fetch the next page". Scrolling back out past the threshold re-arms it.
   *
   * A pending hold is re-measured on every scroll rather than frozen when it was armed: the reader
   * usually carries on scrolling while the page is being fetched, and restoring them to where they
   * were when they crossed the line would undo the scrolling they did in between.
   */
  #checkNearStart(): void {
    const base = this.#base;
    if (!base || !this.nearStart) return;

    if (this.#holdBottom >= 0) this.#holdBottom = base.scrollHeight - base.scrollTop;

    // Nothing to be near the start of. Without this a short list fires on mount, since a scroller
    // with no overflow sits at zero.
    if (base.scrollHeight - base.clientHeight <= AT_END_PX) return;

    const near = base.scrollTop <= this.nearStart;
    if (near === this.#nearStart) return;
    this.#nearStart = near;
    if (!near) return;

    this.#holdBottom = base.scrollHeight - base.scrollTop;
    this.#holdUntil = Date.now() + HOLD_MS;
    this.dispatchEvent(new CustomEvent('nearstart', { bubbles: true, composed: true }));
  }

  /** Every scroll moves at least one control's answer, including the frames of our own follow. */
  #onScrolled = (): void => {
    this.#onScroll();
    this.#checkNearStart();
    this.#syncControls();
  };

  #toEnd(options: { smooth: boolean; far?: boolean }): void {
    const base = this.#base;
    if (!base) return;

    this.#atEnd = true;

    const target = Math.max(0, base.scrollHeight - base.clientHeight);
    if (base.scrollTop >= target) {
      this.#writtenTop = base.scrollTop;
      return;
    }

    /*
      `far` is the difference between following and being sent.

      `SMOOTH_MAX_PX` is a rule about *following*: a backlog landing at once is a change of place
      rather than a movement, and animating across it is a journey nobody watches. It is the wrong
      rule for a press. Somebody who has pressed "jump to the end" has asked to travel, and the
      distance is the reason they pressed it — so applying the cap there made the button smooth on a
      short transcript and instant on a long one, which reads as the animation being broken rather
      than as a rule being applied.
    */
    const smooth =
      options.smooth &&
      typeof base.scrollTo === 'function' &&
      (options.far || target - base.scrollTop <= SMOOTH_MAX_PX) &&
      !prefersReducedMotion();

    if (smooth) {
      // Re-targeting rather than queueing: a second smooth scroll on the same box abandons the
      // first and animates on from wherever it had got to, which is exactly what a destination
      // that keeps moving down wants.
      this.#following = true;
      base.scrollTo({ top: target, behavior: 'smooth' });
      return;
    }

    this.#following = false;
    base.scrollTop = target;
    this.#writtenTop = base.scrollTop;
  }

  /** Where the reader would land pressing "jump to the start". Never re-arms `pin`. */
  #toStart(): void {
    const base = this.#base;
    if (!base) return;

    this.#atEnd = false;
    this.#following = false;
    // Deliberately not recorded as ours: the reader asked for this, so the scroll it produces
    // should be judged as theirs like any other.
    this.#writtenTop = -1;

    // However far it is: this is a press, not a follow. See `far` in `#toEnd`.
    if (typeof base.scrollTo === 'function' && !prefersReducedMotion()) {
      base.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      base.scrollTop = 0;
    }
    this.#syncControls();
  }

  #contentChanged(): void {
    this.#restoreHold();
    this.#follow();
    this.#syncControls();
  }

  /**
   * Put the reader back where they were, now that what they asked for has arrived above them.
   *
   * Only ever after `nearstart`, and only while the hold has not expired — so an ordinary line
   * arriving at the tail of a live list is never mistaken for a prepend and does not move anybody.
   */
  #restoreHold(): void {
    const base = this.#base;
    if (!base || this.#holdBottom < 0) return;
    if (Date.now() > this.#holdUntil) {
      this.#holdBottom = -1;
      return;
    }
    const target = Math.max(0, base.scrollHeight - this.#holdBottom);
    // Nothing arrived above: the height is unchanged, so restoring would be a scroll for no reason.
    if (Math.abs(target - base.scrollTop) < 1) return;
    this.#holdBottom = -1;
    base.scrollTop = target;
    this.#writtenTop = base.scrollTop;
  }

  #follow(): void {
    if (this.pin !== 'end' || !this.#atEnd) return;
    this.#toEnd({ smooth: this.#opened });
    this.#followUntilSettled();
  }

  /**
   * Whether each jump control would currently go anywhere.
   *
   * Measured rather than inferred, and re-measured whenever the content changes as well as
   * whenever the scroller moves — a list growing past the reader is exactly when "jump to the end"
   * becomes worth offering, and nobody has scrolled at that moment.
   */
  #syncControls(): void {
    const base = this.#base;
    if (!base || !this.jump) {
      this._showStart = false;
      this._showEnd = false;
      return;
    }

    const top = base.scrollTop;
    const end = base.scrollHeight - base.clientHeight;
    // Nothing worth jumping across: an ordinary short list should draw no chrome at all.
    const scrollable = end > AT_END_PX;
    const offers = (which: 'start' | 'end') => this.jump === which || this.jump === 'both';

    this._showStart = scrollable && offers('start') && top > AT_END_PX;
    this._showEnd = scrollable && offers('end') && end - top > AT_END_PX;
  }

  /**
   * A second pass, one frame later.
   *
   * Mutation records are delivered on a microtask — before the browser has laid anything out, and
   * before a custom element appended in the same turn has rendered its own shadow content. A row
   * measured then is a row of barely any height, so the follow lands short of a bottom that is
   * about to move down again. This is what leaves a multi-line utterance half under the edge of
   * the panel.
   */
  #followUntilSettled(): void {
    if (typeof requestAnimationFrame !== 'function') return;
    // Every follow extends the deadline: content still arriving is the case this exists for, and a
    // pass that expired mid-arrival would leave the view exactly as short as having no pass at all.
    this.#settleUntil = Date.now() + SETTLE_MS;
    this.#settleHeight = -1;
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(this.#settleFrame);
  }

  /**
   * One frame of the settle pass: measure, follow if the end moved, and stop once it holds still.
   *
   * The stopping condition is the *content* having stopped growing rather than a frame count,
   * because what is being waited for is layout finishing and that has no fixed duration. Two
   * consecutive frames at the same height is the earliest honest moment to say it has.
   */
  #settleFrame = (): void => {
    this.#frame = 0;
    // The first honest measurement of the frame, so the controls are settled here too.
    this.#syncControls();

    const base = this.#base;
    if (!base) return;
    /*
      The budget, checked BEFORE following rather than after.

      A frame is already scheduled when the reader's gesture cancels the pass, and it runs whatever
      the deadline now says — so a check that came after the follow would let exactly one more
      unwanted jump through, which is the one the reader is looking at.
    */
    if (Date.now() > this.#settleUntil) return;
    if (this.pin !== 'end' || !this.#atEnd) return;

    const height = base.scrollHeight;
    const settled = height === this.#settleHeight;
    this.#settleHeight = height;
    // Keep going while it is still moving. A settled list costs exactly the two frames it takes to
    // prove it is settled.
    if (settled) {
      // And the list is now where it belongs, having stopped moving: whatever happens next is
      // something arriving rather than the list opening, so it is worth animating. See `#opened`.
      this.#opened = true;
      return;
    }
    this.#toEnd({ smooth: this.#opened });
    this.#frame = requestAnimationFrame(this.#settleFrame);
  };

  /**
   * The reader has taken the scroller back.
   *
   * The settle pass stops with it: it exists to finish a movement the reader did not ask for, and
   * carrying on through their gesture is precisely the yanking `pin` is careful to avoid. The hold
   * is deliberately NOT cleared — a reader scrolling up is how `nearstart` fires in the first place,
   * so dropping it on their input would mean it never survived to be used. `#onScroll` keeps it
   * measured against wherever they have got to instead.
   */
  #onUserInput = (): void => {
    this.#following = false;
    this.#settleUntil = 0;
  };

  #onJumpStart = (): void => this.#toStart();

  #onJumpEnd = (): void => {
    this.#toEnd({ smooth: true, far: true });
    this.#syncControls();
  };

  render() {
    const dynamicStyles: Record<string, string> = {};
    if (this.maxHeight) dynamicStyles['max-height'] = this.maxHeight;
    if (this.maxWidth) dynamicStyles['max-width'] = this.maxWidth;

    return html`
      <div part="base" style=${styleMap({ ...dynamicStyles, ...this.styles })} @scroll=${this.#onScrolled}>
        <slot></slot>
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
