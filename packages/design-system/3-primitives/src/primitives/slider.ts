import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ref } from 'lit/directives/ref.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  ay: 'center',
  gap: '300',
  width: '100%',
  color: 'text',
  fontSize: '300',
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100' },
  sm: { fontSize: '200' },
  md: { fontSize: '300' },
  lg: { fontSize: '400' },
  xl: { fontSize: '400' },
};

const TRACK_HEIGHT: Record<ComponentSize, string> = {
  xs: '3px',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '10px',
};

/**
 * The smallest gap between two step marks that still reads as two marks.
 *
 * Below this they merge into a texture, which says "there are steps" without saying where — worse
 * than nothing, since it looks like a deliberate pattern. Ten pixels is about where a 1px line and
 * its neighbour stop touching at ordinary densities.
 */
const MIN_TICK_GAP = 10;

const THUMB_SIZE: Record<ComponentSize, string> = {
  xs: '12px',
  sm: '14px',
  md: '18px',
  lg: '22px',
  xl: '26px',
};

const styles = css`
  [part='track-wrapper'] {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }

  input[part='native'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    background: transparent;
    cursor: pointer;
    margin: 0;
  }

  /*
    The track is filled up to the thumb.

    A bare trough says where you may go and nothing about where you are — the thumb alone has to
    carry that, and on a long track the eye has to find it before the value means anything. Filled,
    the reading is the length of the coloured part, which is legible from across the room and is
    what every other progress-shaped control in the app already does.

    Drawn as a hard-stopped gradient rather than Firefox's the -moz-range-progress pseudo-element, so one
    declaration serves both engines — and the stop is in PIXELS, from the --fill custom property, because a percentage
    would be wrong. A range input's thumb travels between its own half-widths, so its centre at
    "50%" is not at 50% of the track, and a percentage fill drifts away from the thumb toward the
    ends. See _geometry() below.
  */
  input[part='native']::-webkit-slider-runnable-track {
    height: var(--track-height);
    border-radius: var(--we-radius-pill);
    background: linear-gradient(
      to right,
      var(--we-role-accent) 0 var(--fill),
      var(--we-role-control-surface) var(--fill)
    );
  }

  input[part='native']::-moz-range-track {
    height: var(--track-height);
    border-radius: var(--we-radius-pill);
    background: linear-gradient(
      to right,
      var(--we-role-accent) 0 var(--fill),
      var(--we-role-control-surface) var(--fill)
    );
  }

  /*
    No ring.

    It was 2px solid white — a literal colour, so on a dark theme the thumb wore a bright halo
    that belonged to no role and followed nothing. What separation the thumb needs from the filled
    track it now gets from the shadow, which is built from shadow-color and so moves with the
    theme.
  */
  input[part='native']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: var(--thumb-size);
    height: var(--thumb-size);
    border-radius: var(--we-radius-full);
    background: var(--we-role-accent);
    box-shadow: 0 1px 3px color-mix(in srgb, var(--we-role-shadow-color) 30%, transparent);
    margin-top: calc((var(--thumb-size) - var(--track-height)) / -2);
  }

  input[part='native']::-moz-range-thumb {
    width: var(--thumb-size);
    height: var(--thumb-size);
    border-radius: var(--we-radius-full);
    border: none;
    background: var(--we-role-accent);
    box-shadow: 0 1px 3px color-mix(in srgb, var(--we-role-shadow-color) 30%, transparent);
  }

  /*
    The steps, as marks on the track.

    Inside the thumb's own travel rather than across the whole track, for the reason the fill is in
    pixels: the first and last positions a thumb can reach are half a thumb in from each end, so
    ticks spread over the full width line up with nothing.

    Under the input, which keeps the pointer: the input is the control and the marks are a reading
    of it. repeating-linear-gradient rather than an element each — a hundred steps is a hundred
    nodes, and this is one box whose geometry the browser already knows how to repeat.
  */
  [part='ticks'] {
    position: absolute;
    top: 50%;
    height: var(--track-height);
    transform: translateY(-50%);
    pointer-events: none;
    border-radius: var(--we-radius-pill);
    background-image: repeating-linear-gradient(
      to right,
      var(--we-role-border-strong) 0 1px,
      transparent 1px var(--tick-gap)
    );
    opacity: 0.55;
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

@customElement('we-slider')
export default class Slider extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Number }) step = 1;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String }) name = '';
  /**
   * What this control is called, for anybody who cannot see the label beside it.
   *
   * Rendered as `aria-label` on the **inner control**, which is the whole point. `we-form-field`
   * puts `aria-labelledby` on its own `role="group"` wrapper, and naming a group does not name the
   * widget inside it — so a screen reader announced these as "edit text", "checkbox, not checked",
   * "slider", with nothing to say which one. `aria-label` on the host does not help either: the
   * host is not the focusable thing.
   *
   * `we-form-field` sets this from its own label when the control does not already carry one, so an
   * existing field gets a name with no change at its call site. Set it directly for a control that
   * has no visible label at all.
   */
  @property({ type: String }) label = '';

  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Boolean }) showValue = false;
  /**
   * Whether the steps are marked on the track.
   *
   * `auto` (the default) shows them when there is room to tell them apart, which is a question about
   * this slider's own width rather than about its step count: eleven steps in a panel and a hundred
   * across a full screen are both legible, and a hundred in a panel is a grey smear. So the element
   * measures itself and shows them at {@link MIN_TICK_GAP} pixels apart or more.
   *
   * `on` and `off` are for a caller that knows better than the measurement — a slider whose steps
   * are the point, or one deliberately drawn as a continuous sweep.
   */
  @property({ type: String, reflect: true }) ticks: 'auto' | 'on' | 'off' = 'auto';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  /** The track's measured width, for the geometry below. 0 until it has been laid out. */
  @state() private _width = 0;
  /** A pointer is down on the control — see {@link _onChange}. */
  private _pressing = false;
  /** What the last release committed, so the native change that follows it is not a second write. */
  private _lastCommitted?: number;
  private _observer?: ResizeObserver;
  private _track?: HTMLElement;

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._observer?.disconnect();
    this._observer = undefined;
  }

  /**
   * Watch the track, so `auto` ticks and the fill follow a resize rather than a first paint.
   *
   * The observer is optional, and that is not defensiveness for its own sake: jsdom has no
   * `ResizeObserver`, so assuming one is there is a primitive that cannot be rendered in a test at
   * all — which is how this was found. Without it the element still measures once and draws
   * correctly; it just does not follow a later resize, which is the right thing to lose in an
   * environment that has no layout to resize.
   */
  private _measure = (el: Element | undefined) => {
    if (!el || el === this._track) return;
    this._observer?.disconnect();
    this._observer = undefined;
    this._track = el as HTMLElement;
    this._width = el.getBoundingClientRect().width;
    if (typeof ResizeObserver === 'undefined') return;
    this._observer = new ResizeObserver(([entry]) => (this._width = entry.contentRect.width));
    this._observer.observe(el);
  };

  /**
   * Where the thumb actually is, in pixels, and how far apart the steps are.
   *
   * The whole reason this is measured rather than expressed as a percentage: a range input's thumb
   * is a box of its own width, and it travels between its two half-widths — so its centre spans
   * `width - thumb` rather than `width`, and everything drawn to line up with it has to use that
   * span. A fill written as a percentage of the track agrees with the thumb only in the middle and
   * is half a thumb out at each end, which is exactly where somebody looks to check they reached
   * the bottom.
   */
  private _geometry() {
    const thumb = Number.parseFloat(THUMB_SIZE[this.size]);
    const span = this.max - this.min;
    const travel = Math.max(0, this._width - thumb);
    const along = span > 0 ? Math.min(1, Math.max(0, (this.value - this.min) / span)) : 0;
    const steps = this.step > 0 && span > 0 ? Math.round(span / this.step) : 0;
    return { thumb, travel, steps, fill: thumb / 2 + along * travel, gap: steps ? travel / steps : 0 };
  }

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Slider & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  /**
   * Fires continuously while dragging.
   *
   * `this.value` is updated here, and that is not incidental — leaving it stale is what made the
   * thumb trail behind the pointer. `render()` binds `.value=${String(this.value)}`, so any
   * re-render during a drag wrote the *old* number back onto the native input and yanked the thumb
   * backwards; it only caught up once the consumer's own state had round-tripped and pushed a new
   * `value` down. On a slider driving something expensive — a theme's colours, say — that round trip
   * is long enough to see, and it reads as the whole app being slow rather than as the control
   * fighting itself.
   *
   * Updating optimistically means the element always agrees with the input inside it. A consumer
   * that wants to reject or clamp the value still can: it sets `value` back, and that wins, exactly
   * as it did before.
   */
  private _onInput(e: Event) {
    e.stopPropagation();
    const val = Number((e.target as HTMLInputElement).value);
    this.value = val;
    this.dispatchEvent(new CustomEvent('input', { detail: val, bubbles: true, composed: true }));
  }

  /**
   * Fires once when the user settles on a value — which is **not** the same as the value changing.
   *
   * A native range input dispatches `change` only when the number differs from what it was, and
   * that is the wrong question for this control. A slider showing its minimum because nobody has
   * answered yet looks identical to one showing its minimum because somebody chose it — so dragging
   * the thumb to the bottom of an unanswered slider moved nothing, fired nothing, and wrote
   * nothing. The strongest answer on the scale was the one answer that could not be given first.
   *
   * So a press that ends on the control commits whatever it is on, changed or not. `change` means
   * "the person settled on this", and a consumer that only wants real movement compares.
   *
   * The two paths cannot both fire: while a pointer is down the native event is swallowed and the
   * release commits, which is one dispatch per gesture whether or not the value moved. A keyboard
   * change has no press in flight and goes straight through.
   */
  private _onChange(e: Event) {
    e.stopPropagation();
    const val = Number((e.target as HTMLInputElement).value);
    this.value = val;
    // Still down: the release is what commits, so this one is the gesture talking to itself.
    if (this._pressing) return;
    /*
      The release already committed this exact value, so this is its echo.

      A bare range input in Chrome fires `pointerdown > input… > pointerup > change`, so the native
      change arrives AFTER the release; committing on both would be two writes for one drag. Through
      this element real Chrome delivers no trailing change at all — measured, see the note in
      `slider.test.ts` — so this guard is for the browsers that do, and costs nothing where none
      comes.

      Matched on the VALUE rather than on a "we already fired" flag, which would have to be cleared
      on a timer: a press that moves nothing produces no change at all, so the flag would still be
      up when the next arrow key arrived and would eat it.
    */
    if (val === this._lastCommitted) {
      this._lastCommitted = undefined;
      return;
    }
    this._commit(val);
  }

  private _commit(val: number) {
    this.dispatchEvent(new CustomEvent('change', { detail: val, bubbles: true, composed: true }));
  }

  private _onPointerDown() {
    if (this.disabled) return;
    this._pressing = true;
    this._lastCommitted = undefined;
  }

  /** The release IS the commit — see {@link _onChange}. Also covers a press that moved nothing. */
  private _onPointerUp() {
    if (!this._pressing) return;
    this._pressing = false;
    this._lastCommitted = this.value;
    this._commit(this.value);
  }

  render() {
    const trackH = TRACK_HEIGHT[this.size];
    const thumbS = THUMB_SIZE[this.size];
    const { thumb, steps, fill, gap } = this._geometry();
    const showTicks =
      this.ticks === 'on' || (this.ticks === 'auto' && steps > 1 && gap >= MIN_TICK_GAP && this._width > 0);

    return html`
      <div part="base" style=${styleMap(this.styles || {})}>
        <div part="track-wrapper" ${ref(this._measure)}>
          ${
            showTicks
              ? html`<div
                  part="ticks"
                  style=${styleMap({
                    left: `${thumb / 2}px`,
                    right: `${thumb / 2}px`,
                    '--tick-gap': `${gap}px`,
                    '--track-height': trackH,
                  })}
                ></div>`
              : null
          }
          <input
            part="native"
            aria-label=${this.label || nothing}
            type="range"
            min=${this.min}
            max=${this.max}
            step=${this.step}
            .value=${String(this.value)}
            ?disabled=${this.disabled}
            @input=${this._onInput}
            @change=${this._onChange}
            @pointerdown=${this._onPointerDown}
            @pointerup=${this._onPointerUp}
            @pointercancel=${this._onPointerUp}
            style=${styleMap({
              '--track-height': trackH,
              '--thumb-size': thumbS,
              '--fill': `${fill}px`,
            })}
          />
        </div>
        ${this.showValue ? html`<span part="value">${this.value}</span>` : null}
      </div>
    `;
  }
}
