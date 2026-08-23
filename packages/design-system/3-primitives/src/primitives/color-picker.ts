import type { DesignSystemProps } from '@we/design-types';
import { type ColorFormat, formatColor, hsvToRgb, parseColor, type Rgba, rgbToHsv } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline-flex',
  direction: 'column',
  gap: '200',
  /*
    The host is the popover's containing block, and it has to be declared *here* to be one.

    The popover is absolutely positioned and is a direct child of the shadow root, so whatever
    positions the host decides where it can be placed and — the part that actually bit — which
    scrolling box it belongs to. Left static, its containing block escaped the component entirely:
    inside a we-scroll-area the panel scrolled and the popover did not, so a swatch two thirds of
    the way down a scrolled list opened its picker several hundred pixels away from itself.

    Declared as a default *prop* rather than as a :host rule in this file's styles, because a
    :host rule loses. The generated design-system stylesheet emits `position: var(--we-<name>-position)`
    for every element that takes layout props, with no fallback, which computes to the initial value
    when nothing sets it — and it comes later in the cascade, so it silently beat a hand-written
    :host { position: relative } sitting right above it. Setting the prop populates that variable
    instead of fighting it, and a consumer passing `position` still wins, as it should.
  */
  position: 'relative',
};

/**
 * The design-token grid, as hue families by shade.
 *
 * The point of offering tokens at all is that a token stays inside the parametric system: a role
 * pinned to `var(--we-color-neutral-200)` still follows the theme's hue, saturation and light/dark
 * polarity, where the same colour pinned as `#e4e4e7` follows nothing. So the grid is not a
 * convenience over the colour area — it is the option that keeps a theme a theme, which is why it
 * is what the picker opens on when tokens are enabled.
 */
const TOKEN_HUES = ['neutral', 'primary', 'success', 'warning', 'danger'] as const;
const TOKEN_SHADES = ['0', '25', '50', '75', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000'];

const PALETTE = [
  '#000000',
  '#434343',
  '#666666',
  '#999999',
  '#b7b7b7',
  '#cccccc',
  '#d9d9d9',
  '#ffffff',
  '#980000',
  '#ff0000',
  '#ff9900',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#4a86e8',
  '#0000ff',
  '#9900ff',
  '#ff00ff',
  '#e6b8af',
  '#f4cccc',
  '#fce5cd',
  '#fff2cc',
  '#d9ead3',
  '#d0e0e3',
  '#c9daf8',
  '#cfe2f3',
  '#d9d2e9',
  '#ead1dc',
];

/*
  A grey chequerboard, so a translucent colour reads as translucent rather than as a pale one.

  Kept as an *image* with its size applied separately, because the colour has to sit on top of it as
  another image layer: `background: <colour>, <image>` is invalid CSS — a colour is only legal in the
  final layer — and the whole declaration is dropped, which is why the swatch painted nothing at all.
  `linear-gradient(c, c)` is the standard way to spell "this colour, as a layer".
*/
const CHECKER_IMAGE = 'repeating-conic-gradient(var(--we-role-surface-active) 0% 25%, var(--we-role-surface) 0% 50%)';

/** A colour as a background layer, over the chequerboard. */
function swatchLayers(color: string) {
  return {
    'background-image': `linear-gradient(${color}, ${color}), ${CHECKER_IMAGE}`,
    'background-size': 'auto, 12px 12px',
  };
}

const styles = css`
  [part='preview'] {
    all: unset;
    display: block;
    /* Square by construction and settable, so a caller wanting a 28px row swatch asks for one
       instead of squeezing the host and getting a rectangle. */
    width: var(--we-color-picker-swatch, 48px);
    height: var(--we-color-picker-swatch, 48px);
    border-radius: var(--we-radius-400);
    border: 2px solid var(--we-role-border);
    cursor: pointer;
    box-sizing: border-box;
    transition: border-color var(--we-transition-200, 150ms) ease;
  }

  [part='preview']:hover {
    border-color: var(--we-role-accent);
  }

  [part='preview']:focus-visible {
    outline: 2px solid var(--we-ring-color, var(--we-role-focus));
    outline-offset: 2px;
  }

  [part='popover'] {
    position: absolute;
    z-index: var(--we-z-dropdown);
    width: max-content;
    background: var(--we-role-surface-raised);
    border: 1px solid var(--we-role-border);
    border-radius: var(--we-radius-500);
    box-shadow: 0 4px 16px color-mix(in srgb, var(--we-role-shadow-color) 12%, transparent);
    padding: var(--we-space-400);
    display: flex;
    flex-direction: column;
    gap: var(--we-space-300);
  }

  [part='tabs'] {
    display: flex;
    gap: var(--we-space-100);
  }

  [part='tab'] {
    all: unset;
    flex: 1;
    text-align: center;
    cursor: pointer;
    padding: var(--we-space-100) var(--we-space-200);
    border-radius: var(--we-radius-300);
    font-size: var(--we-font-size-200);
    color: var(--we-role-text-muted);
  }

  [part='tab'][aria-selected='true'] {
    background: var(--we-role-accent-muted);
    color: var(--we-role-accent-text);
  }

  [part='tokens'] {
    display: grid;
    grid-template-columns: repeat(14, 1fr);
    gap: 3px;
  }

  [part='palette'] {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }

  [part~='swatch'] {
    all: unset;
    /* all:unset makes a button display:inline, which ignores width and height. Grid blockifies its
       children so this is belt-and-braces — but it is the difference between a swatch and a 4px
       sliver the moment one is rendered outside a grid. */
    display: block;
    width: 24px;
    height: 24px;
    border-radius: var(--we-radius-300);
    cursor: pointer;
    border: 2px solid transparent;
    box-sizing: border-box;
    transition: border-color var(--we-transition-200, 150ms) ease;
  }

  [part~='token'] {
    width: 18px;
    height: 18px;
    border-radius: var(--we-radius-200);
  }

  [part~='swatch']:hover,
  [part~='token']:hover {
    border-color: var(--we-role-border-strong);
  }

  [part~='swatch'][aria-selected='true'],
  [part~='token'][aria-selected='true'] {
    border-color: var(--we-role-accent);
  }

  /* The saturation/value area: white left→right over black bottom→top, on the pure hue. */
  [part='area'] {
    position: relative;
    width: 100%;
    height: 132px;
    border-radius: var(--we-radius-300);
    cursor: crosshair;
    touch-action: none;
  }

  [part='area-thumb'],
  [part='slider-thumb'] {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 40%);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  [part='slider'] {
    position: relative;
    height: 12px;
    border-radius: var(--we-radius-pill);
    cursor: pointer;
    touch-action: none;
  }

  [part='slider-thumb'] {
    top: 50%;
  }

  [part='fields'] {
    display: flex;
    align-items: center;
    gap: var(--we-space-200);
  }

  [part='fields'] input {
    all: unset;
    box-sizing: border-box;
    border: 1px solid var(--we-role-border);
    border-radius: var(--we-radius-400);
    padding: var(--we-space-100) var(--we-space-200);
    font-size: 0.875em;
    color: var(--we-role-text);
    flex: 1;
    min-width: 0;
    font-family: monospace;
  }

  /*
    A segmented control rather than a <select>.

    A native select renders its list with the user agent's own colours, which take the platform
    scheme rather than the theme's — in a dark theme it came out white-on-white and the current
    option was unreadable until you highlighted it. Nothing inside that popup is reachable from CSS,
    so the only fix that actually themes it is not to use one.
  */
  [part='formats'] {
    display: flex;
    border: 1px solid var(--we-role-border);
    border-radius: var(--we-radius-400);
    overflow: hidden;
  }

  [part='format'] {
    all: unset;
    display: block;
    cursor: pointer;
    padding: var(--we-space-100) var(--we-space-200);
    font-size: 0.75em;
    color: var(--we-role-text-muted);
  }

  [part='format'][aria-pressed='true'] {
    background: var(--we-role-accent-muted);
    color: var(--we-role-accent-text);
  }

  [part='dropper'] {
    all: unset;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    border: 1px solid var(--we-role-border);
    border-radius: var(--we-radius-400);
    cursor: pointer;
    color: var(--we-role-text-muted);
  }

  [part='dropper']:hover {
    color: var(--we-role-accent-text);
    border-color: var(--we-role-accent);
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

type Tab = 'tokens' | 'custom';

@customElement('we-color-picker')
export default class ColorPicker extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) value = '#000000';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String }) name = '';
  /** Legacy fixed swatch list. Shown only when `tokens` is off. */
  @property({ type: Array }) palette = PALETTE;
  /**
   * Offer the design tokens, and open on them.
   *
   * Off by default so existing callers keep the swatch list they had. On for anything choosing a
   * colour *for the interface* — a theme role, a component default — where a token is the answer
   * that survives a change of theme.
   */
  @property({ type: Boolean }) tokens = false;
  /** Allow a transparency. Off by default; a role that carries alpha (the scrim) turns it on. */
  @property({ type: Boolean }) alpha = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  @state() private _open = false;
  @state() private _tab: Tab = 'custom';
  @state() private _format: ColorFormat = 'hex';
  /** The colour being dragged, in HSV — the area's own coordinates, so a drag does not round-trip. */
  @state() private _hsv = { h: 0, s: 0, v: 0 };
  @state() private _alpha = 1;
  /** What is in the text field while it is being typed, so a half-typed value is not reformatted. */
  @state() private _draft: string | null = null;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  /**
   * Whether the browser will let us sample a pixel from anywhere on screen.
   *
   * `EyeDropper` is a real platform API — it opens the OS-level magnifier and returns the pixel the
   * user clicks, from *any* window, which is the whole point: the colour somebody wants is usually
   * in a screenshot or another app, not already in this document. Chromium-only for now, so the
   * button is absent rather than present-and-broken where it is not.
   */
  private static get _canDrop(): boolean {
    return typeof window !== 'undefined' && 'EyeDropper' in window;
  }

  private async _pickFromScreen() {
    type Dropper = { open: () => Promise<{ sRGBHex: string }> };
    const Ctor = (window as unknown as { EyeDropper: new () => Dropper }).EyeDropper;
    try {
      const { sRGBHex } = await new Ctor().open();
      const parsed = parseColor(sRGBHex);
      if (!parsed) return;
      this._hsv = rgbToHsv(parsed);
      // The API samples what is on screen, which is always opaque; keep whatever alpha was set
      // rather than silently making a translucent role solid.
      this._draft = null;
      this._emitCurrent();
    } catch {
      // The user pressed Escape out of the magnifier. Not an error, and nothing to report.
    }
  }

  /*
    Close on a click anywhere else, and on Escape.

    The listener is on the document because the click that should close this lands on something
    else entirely; `composedPath` rather than `contains` because the popover is inside a shadow root
    and a plain target check sees only the host. Bound while open and dropped when not, so a page
    with forty swatch pickers is not forty live listeners.
  */
  private _onDocPointer = (e: Event) => {
    if (!e.composedPath().includes(this)) this._open = false;
  };

  private _onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this._open) {
      this._open = false;
      this.shadowRoot?.querySelector<HTMLElement>('[part="preview"]')?.focus();
    }
  };

  updated(changed: Map<PropertyKey, unknown>) {
    super.updated(changed);
    if (!changed.has('_open')) return;
    if (this._open) {
      document.addEventListener('pointerdown', this._onDocPointer);
      document.addEventListener('keydown', this._onKey);
    } else {
      document.removeEventListener('pointerdown', this._onDocPointer);
      document.removeEventListener('keydown', this._onKey);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this._onDocPointer);
    document.removeEventListener('keydown', this._onKey);
  }

  /** The token this value names, if it names one — which is also what selects the Tokens tab. */
  private get _token(): string | null {
    const m = /^var\(--we-color-([a-z]+-\d+)\)$/.exec(this.value?.trim() ?? '');
    return m ? m[1] : null;
  }

  private _syncFromValue() {
    const parsed = parseColor(this.value ?? '');
    if (parsed) {
      this._hsv = rgbToHsv(parsed);
      this._alpha = parsed.a;
    }
    this._tab = this.tokens && (this._token || !parsed) ? 'tokens' : 'custom';
  }

  private _openPopover() {
    this._syncFromValue();
    this._draft = null;
    this._open = true;
  }

  private _emit(color: string) {
    this.value = color;
    this.dispatchEvent(new CustomEvent('change', { detail: color, bubbles: true, composed: true }));
  }

  /** The current HSV + alpha as the string this component emits. */
  private _emitCurrent() {
    const rgba: Rgba = { ...hsvToRgb(this._hsv.h, this._hsv.s, this._hsv.v), a: this.alpha ? this._alpha : 1 };
    this._emit(formatColor(rgba, this._format));
  }

  private _onText(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    this._draft = raw;
    const parsed = parseColor(raw);
    if (!parsed) return;
    this._hsv = rgbToHsv(parsed);
    this._alpha = parsed.a;
    this._emit(formatColor(parsed, this._format));
  }

  /**
   * Track a pointer across an area or slider until it is released.
   *
   * Pointer events rather than mouse, and capture rather than a document listener: a drag that
   * leaves the swatch still belongs to the swatch, and on a touchscreen there is no mouse at all.
   */
  private _track(e: PointerEvent, onMove: (fx: number, fy: number) => void) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const apply = (ev: PointerEvent) => {
      onMove(
        Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)),
      );
      this._draft = null;
      this._emitCurrent();
    };
    apply(e);
    const move = (ev: PointerEvent) => apply(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  private _renderTokens() {
    const swatch = (token: string) => {
      const value = `var(--we-color-${token})`;
      return html`<button
        part="swatch token"
        style=${styleMap({ background: value })}
        aria-selected=${this._token === token ? 'true' : 'false'}
        aria-label=${token}
        title=${token}
        @click=${() => this._emit(value)}
      ></button>`;
    };
    return html`<div part="tokens">
      ${TOKEN_HUES.map((hue) => TOKEN_SHADES.map((shade) => swatch(`${hue}-${shade}`)))}
    </div>`;
  }

  private _renderCustom() {
    const { h, s, v } = this._hsv;
    const rgb = hsvToRgb(h, s, v);
    const hex = formatColor({ ...rgb, a: 1 }, 'hex');
    const shown = this._draft ?? formatColor({ ...rgb, a: this.alpha ? this._alpha : 1 }, this._format);
    return html`
      <div
        part="area"
        style=${styleMap({
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${h} 100% 50%)`,
        })}
        @pointerdown=${(e: PointerEvent) =>
          this._track(e, (fx, fy) => {
            this._hsv = { ...this._hsv, s: fx, v: 1 - fy };
          })}
      >
        <div
          part="area-thumb"
          style=${styleMap({ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: hex })}
        ></div>
      </div>

      <div
        part="slider"
        style="background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
        @pointerdown=${(e: PointerEvent) =>
          this._track(e, (fx) => {
            this._hsv = { ...this._hsv, h: fx * 360 };
          })}
      >
        <div
          part="slider-thumb"
          style=${styleMap({ left: `${(h / 360) * 100}%`, background: `hsl(${h} 100% 50%)` })}
        ></div>
      </div>

      ${
        this.alpha
          ? html`<div
              part="slider"
              style=${styleMap({
                'background-image': `linear-gradient(to right, transparent, ${hex}), ${CHECKER_IMAGE}`,
                'background-size': 'auto, 12px 12px',
              })}
              @pointerdown=${(e: PointerEvent) =>
                this._track(e, (fx) => {
                  this._alpha = Math.round(fx * 100) / 100;
                })}
            >
              <div part="slider-thumb" style=${styleMap({ left: `${this._alpha * 100}%`, background: hex })}></div>
            </div>`
          : ''
      }

      <div part="fields">
        <div part="formats" role="group" aria-label="Colour format">
          ${(['hex', 'rgb', 'hsl', 'oklch'] as const).map(
            (f) =>
              html`<button
                part="format"
                aria-pressed=${this._format === f ? 'true' : 'false'}
                @click=${() => {
                  this._format = f;
                  this._draft = null;
                  this._emitCurrent();
                }}
              >
                ${f.toUpperCase()}
              </button>`,
          )}
        </div>
        <input
          aria-label="Colour value"
          spellcheck="false"
          .value=${shown}
          @input=${(e: Event) => this._onText(e)}
          @blur=${() => (this._draft = null)}
        />
        ${
          ColorPicker._canDrop
            ? html`<button part="dropper" title="Pick a colour from the screen" @click=${() => this._pickFromScreen()}>
                <we-icon name="eyedropper" size="xs"></we-icon>
              </button>`
            : ''
        }
      </div>
    `;
  }

  render() {
    const showTabs = this.tokens;
    return html`
      <button
        part="preview"
        aria-haspopup="dialog"
        aria-expanded=${this._open ? 'true' : 'false'}
        aria-label=${`Colour: ${this.value}`}
        style=${styleMap(swatchLayers(this.value || 'transparent'))}
        ?disabled=${this.disabled}
        @click=${() => (this._open ? (this._open = false) : this._openPopover())}
      ></button>

      ${
        this._open
          ? html`<div part="popover" role="dialog">
              ${
                showTabs
                  ? html`<div part="tabs">
                      <button
                        part="tab"
                        aria-selected=${this._tab === 'tokens' ? 'true' : 'false'}
                        @click=${() => (this._tab = 'tokens')}
                      >
                        Tokens
                      </button>
                      <button
                        part="tab"
                        aria-selected=${this._tab === 'custom' ? 'true' : 'false'}
                        @click=${() => (this._tab = 'custom')}
                      >
                        Custom
                      </button>
                    </div>`
                  : ''
              }
              ${
                showTabs && this._tab === 'tokens'
                  ? this._renderTokens()
                  : showTabs
                    ? this._renderCustom()
                    : html`<div part="palette">
                          ${this.palette.map(
                            (color) =>
                              html`<button
                                part="swatch"
                                style=${styleMap({ background: color })}
                                aria-selected=${color === this.value ? 'true' : 'false'}
                                aria-label=${color}
                                @click=${() => this._emit(color)}
                              ></button>`,
                          )}
                        </div>
                        ${this._renderCustom()}`
              }
            </div>`
          : ''
      }
    `;
  }
}
