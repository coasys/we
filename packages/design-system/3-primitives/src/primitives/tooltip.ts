import {
  arrow,
  autoUpdate,
  computePosition,
  flip,
  offset,
  Placement as FloatingPlacement,
  shift,
} from '@floating-ui/dom';
import type { Placement } from '@we/design-types';
import { css, html, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

import { anchorInSlot, DEV_BUILD, warnAboutBoxlessLayoutProps } from '../shared/boxless';
import { LayoutElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

let tooltipIdCounter = 0;

const CSS_STYLES = css`
  :host {
    /* The wrapper must not exist as a box — see the class doc.

       This was inline-flex, and every layout fault it caused was fixed by tuning the box rather
       than by removing it: the host used to be inline-block, which stood on the parent's text
       baseline and left room for descenders, so a row of avatars rode high inside it. Flex fixed
       that symptom and left the cause, which is that a decorating wrapper was taking part in its
       parent's layout at all.

       A box here takes the grid track its child should have taken, becomes the flex item its child
       should have been, absorbs stretch alignment, and counts once more in a gap. The flex-item
       case is the one that kept surfacing: a we-badge declaring flex-shrink: 0 says nothing about
       the box around it, so every tooltip in a tight row had to repeat the declaration on the
       wrapper — which is a rule nobody can be expected to remember at 99 call sites. */
    --we-tooltip-host-display: contents;
    display: var(--we-tooltip-host-display, contents);
  }

  /* Boxless for the same reason as the host: with display:contents above and a real box here, the
     box has only moved down a level and the trigger span becomes the flex item instead. */
  [part='trigger'] {
    display: contents;
  }

  [part='tooltip'] {
    display: none;
    position: fixed;
    /* Reset UA [popover] styles when promoted to top layer. width/overflow matter most:
       the UA default (width: fit-content; overflow: auto) sizes from the element's static
       position — which is the trigger's own tiny box before floating-ui repositions it via
       JS. Triggers with little room around them (e.g. the panel rail, flush against the
       viewport edge) get crushed into that sliver, and since text can't wrap (nowrap), the
       UA's overflow:auto then draws a scrollbar on the bubble itself. */
    margin: 0;
    inset: unset;
    border: none;
    width: max-content;
    height: auto;
    overflow: visible;
    /* Component styles */
    z-index: var(--we-z-tooltip);
    /*
      A phrase never breaks; anything longer is allowed to.

      nowrap is right for what a tooltip usually is — "Delete this reply" folding onto two lines
      would be worse than wide. It is wrong the moment the bubble carries a sentence: a signal type
      says what a community means by it, and under nowrap that came out as one line as wide as the
      description, which in a 320px panel is a tooltip wider than the app.

      So the cap does the deciding. width: max-content still shrink-wraps a phrase, and max-width
      only bites once the content is longer than the cap — at which point normal lets it wrap into
      the column the cap defines. Nothing a caller writes changes: a short string is drawn exactly
      as it was.

      280px rather than a layout token, because the layout tokens are page measures: the smallest,
      xs, is 420px, which is most of a docked panel and far too wide for an aside. A variable so a
      caller with a genuinely longer aside can say so, which is cheaper than a prop nobody sets.

      overflow-wrap under it for the one thing a cap cannot handle: a single token longer than the
      column — a URL, a DID — which would otherwise push the bubble past it.

      (No backticks in here: this is a tagged template literal, and one ends the string.)
    */
    max-width: var(--we-tooltip-max-width, 280px);
    white-space: normal;
    overflow-wrap: anywhere;
    font-size: var(--we-font-size-200, 14px);
    font-weight: 500;
    padding: var(--we-space-300, 8px) var(--we-space-300, 8px);
    /* The inverse pair. Not text/onInverse: those are scale positions, so they flip with the
       theme and a dark tooltip in light mode became a white one in dark. Both halves of this pair
       hold a fixed lightness, so the tooltip stays opposite to the page in either polarity. */
    background: var(--we-role-surface-inverse);
    color: var(--we-role-on-inverse);
    border-radius: var(--we-border-radius, 4px);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--we-role-shadow-color) 15%, transparent);
    /*
      Never takes the pointer, open or closed.

      It used to become pointer-events: auto once open, which is the pattern for a tooltip holding
      something to interact with — a link, a button. This one holds a string. What it bought was
      nothing and what it cost was the control underneath: hover a thing, the bubble appears over
      part of it, and the click that follows lands on the bubble. Found on a comment's fold, where
      the target is a tall column and the bubble sits across it, and the press simply did not
      arrive.
    */
    pointer-events: none;
  }

  :host([open]) [part='tooltip'] {
    display: block;
  }

  [part='arrow'],
  [part='arrow']::before {
    position: absolute;
    width: 8px;
    height: 8px;
    background: inherit;
  }

  [part='arrow'] {
    visibility: hidden;
  }

  [part='arrow']::before {
    visibility: visible;
    content: '';
    transform: rotate(45deg);
  }
`;

@customElement('we-tooltip')
export default class Tooltip extends LayoutElement {
  static styles = [sharedStyles, CSS_STYLES];

  private _tooltipId = `we-tooltip-${++tooltipIdCounter}`;

  @property({ type: Boolean, reflect: true }) open = false;
  /**
   * What the tooltip says.
   *
   * ## Why this is not called `title`
   *
   * It was, and that name is a trap rather than a preference. `title` is a **global HTML
   * attribute**, so a component that declares one is sharing a name with a browser feature: the
   * value reflected to the host produced the browser's own native tooltip *as well as* this one —
   * two bubbles for one phrase, ours immediately and the browser's a second later, unstyled.
   *
   * Dropping the reflection was not enough to trust, either. An attribute set directly (which
   * hand-written JSX does for a custom element) brings the native tooltip straight back, and
   * nothing about that failure is visible from the call site. The only fix that cannot recur is to
   * stop squatting on the name.
   *
   * Not reflected: it is prose, and an attribute holding a sentence is noise in the inspector.
   * Slotted `content` overrides it, for a tooltip that is not a phrase — see `render`.
   */
  @property({ type: String }) content = '';
  @property({ type: String, reflect: true }) placement: Placement = 'top';

  @query('[part="tooltip"]') tooltipEl!: HTMLElement;
  @query('[part="arrow"]') arrowEl!: HTMLElement;

  /**
   * What the bubble is positioned against: the first slotted thing that actually has a box.
   *
   * Neither the host nor `[part='trigger']` generates one any more, and a boxless element has no
   * rectangle to measure — `getBoundingClientRect` on one is zero at the origin, which puts the
   * bubble in the top-left corner of the screen. So the anchor has to be found rather than assumed.
   *
   * ## Why the slotted element is not enough
   *
   * The schema renderer wraps every node in a `display: contents` div, so `assignedElements` hands
   * back wrappers rather than what an author wrote — and a wrapper is boxless for the same reason
   * this element now is. Taking the assigned element at face value therefore worked in a test that
   * mounted the child directly and put every tooltip in the corner in the real app.
   * `we-sortable._resolveItem` sees through the same wrappers for the same reason, one concept
   * along, where it costs a drag its geometry instead of a bubble its position.
   *
   * So: descend until something generates a box. Through the light DOM first, then the shadow root,
   * which is where a boxless custom element keeps its own drawing — `we-icon` is `display: contents`
   * and renders an `svg` inside, so a tooltip on a bare icon is anchored on that svg.
   */
  private get anchorEl(): HTMLElement {
    return anchorInSlot(this.renderRoot?.querySelector('slot:not([name])') as HTMLSlotElement | null, this);
  }

  @state() private cleanup?: () => void;

  firstUpdated() {
    /*
      `mouseover`/`mouseout`, not `mouseenter`/`mouseleave`, now that the host has no box.

      Enter and leave do not bubble: they are dispatched along the ancestor chain the pointer
      crossed, and whether a `display: contents` element counts as part of that chain is a corner
      of the spec no consumer of this should have to bet on. Over and out bubble, so the host is on
      the composed path by construction — the only cost is the containment check below, which is
      the well-worn way of ignoring the crossings *between* a trigger's own descendants.

      `focusin`/`focusout` are already the bubbling pair, which is why they are untouched.
    */
    this.addEventListener('mouseover', this._onOver);
    this.addEventListener('mouseout', this._onOut);
    this.addEventListener('focusin', this.show);
    this.addEventListener('focusout', this.hide);
    this._warnAboutTitle();
    warnAboutBoxlessLayoutProps(this, 'we-tooltip');
  }

  /** Entering from outside — a move within the trigger is not an entry. */
  private _onOver = (event: MouseEvent) => {
    if (this._within(event.relatedTarget)) return;
    this.show();
  };

  /** Leaving for somewhere outside — a move between the trigger's own children is not a departure. */
  private _onOut = (event: MouseEvent) => {
    if (this._within(event.relatedTarget)) return;
    this.hide();
  };

  private _within(node: EventTarget | null): boolean {
    return node instanceof Node && this.contains(node);
  }

  /**
   * Say so when somebody writes `title` here, rather than quietly showing two tooltips.
   *
   * The rename stops this element from *producing* a native tooltip. It cannot stop a consumer
   * asking for one by hand, and that mistake is invisible from the call site: the styled bubble
   * still appears, so nothing looks broken until the browser's own arrives a second later — which
   * is how this survived long enough to be reported three times.
   *
   * A diagnostic rather than a silent fix: removing the attribute would also swallow the one case
   * where somebody genuinely meant a native tooltip, and leave them wondering where it went. The
   * same shape as `warnAboutSmil` in `we-html`, and for the same reason — the failure was never the
   * behaviour, it was that nothing said anything.
   */
  private _warnAboutTitle() {
    if (!DEV_BUILD) return;
    if (!this.hasAttribute('title')) return;
    console.warn(
      `we-tooltip: a \`title\` attribute here gives the browser's own tooltip as well as this one. ` +
        `Use \`content\` for what the tooltip says; if the trigger needs an accessible name, put it ` +
        `on the trigger (\`label\` on a we-button) rather than out here.`,
      this,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanup?.();
  }

  // `super.updated` first — the design system writes its custom properties there, so an override
  // that skips it silently disables every DS prop on this element. See the note in video.ts, which
  // is where the consequences were finally noticed.
  updated(changed: PropertyValues) {
    super.updated(changed);
    // A tooltip whose text is bound to a signal would otherwise keep describing the trigger with
    // whatever it said first.
    if (changed.has('content')) this._describeTrigger();
    if (changed.has('open')) {
      if (this.open) this.openTooltip();
      else this.closeTooltip();
      this.dispatchEvent(new CustomEvent('toggle', { bubbles: true, composed: true }));
    }
  }

  private async updatePosition() {
    if (!this.tooltipEl || !this.arrowEl) return;

    // Convert 'auto' to 'top' for Floating UI compatibility
    const floatingPlacement = this.placement.startsWith('auto') ? 'top' : (this.placement as FloatingPlacement);

    const { x, y, placement, middlewareData } = await computePosition(this.anchorEl, this.tooltipEl, {
      strategy: 'fixed',
      placement: floatingPlacement,
      middleware: [offset(10), flip(), shift({ padding: 8 }), arrow({ element: this.arrowEl })],
    });

    // Position tooltip
    Object.assign(this.tooltipEl.style, { left: `${x}px`, top: `${y}px` });

    // Position arrow
    if (middlewareData.arrow) {
      const { x: arrowX, y: arrowY } = middlewareData.arrow;
      const staticSide = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[placement.split('-')[0]]!;

      Object.assign(this.arrowEl.style, {
        left: arrowX != null ? `${arrowX}px` : '',
        top: arrowY != null ? `${arrowY}px` : '',
        right: '',
        bottom: '',
        [staticSide]: '-4px',
      });
    }
  }

  private openTooltip() {
    if (!this.tooltipEl) return;

    // Promote to browser top layer so position:fixed resolves to the viewport
    // instead of an ancestor backdrop-filter containing block.
    if ('showPopover' in this.tooltipEl) {
      this.tooltipEl.setAttribute('popover', 'manual');
      try {
        (this.tooltipEl as HTMLElement & { showPopover(): void }).showPopover();
      } catch {}
    }

    this.cleanup = autoUpdate(this.anchorEl, this.tooltipEl, () => this.updatePosition());
  }

  private closeTooltip() {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = undefined;
    }
    if (this.tooltipEl && 'hidePopover' in this.tooltipEl) {
      try {
        (this.tooltipEl as HTMLElement & { hidePopover(): void }).hidePopover();
      } catch {}
      this.tooltipEl.removeAttribute('popover');
    }
  }

  /**
   * Open — unless there is nothing to say.
   *
   * A tooltip with no text and nothing slotted paints an empty bubble, which is never what anybody
   * wanted and reads as a glitch. It is not hypothetical: a control that shows its reading only
   * while it is being dragged has empty content the rest of the time, and hovering it produced a
   * blank card hanging off a slider.
   *
   * Only the HOVER and FOCUS paths ask. Setting `open` directly is a caller saying "show this now",
   * and a caller that does so with nothing to show has made a different mistake — one this should
   * not paper over, since silently ignoring the instruction is harder to find than an empty box.
   */
  private show = () => {
    if (!this._hasSomethingToSay()) return;
    this.open = true;
  };

  /** Text, or anything slotted into `content` — the two ways a bubble is given something to show. */
  private _hasSomethingToSay(): boolean {
    if (this.content.trim()) return true;
    const slotted = this.querySelector('[slot="content"]');
    return Boolean(slotted && (slotted.textContent ?? '').trim());
  }

  private hide = () => {
    this.open = false;
  };

  /**
   * Point `aria-describedby` at the tooltip from the element that is actually focused.
   *
   * It was on the wrapper `<span part="trigger">`, which is not focusable and is not what a screen
   * reader is on when the tooltip appears — so the description was never read out, for any tooltip
   * in the app. The focusable thing is whatever the consumer slotted (a `we-button`, an avatar), so
   * the attribute has to go there.
   *
   * The id lives in this shadow root and the slotted element in the light DOM, so they are in
   * different trees and `aria-describedby` cannot cross that. The description is copied onto the
   * trigger with `aria-description` instead — the text rather than a reference, which is exactly
   * what that attribute is for and the one thing that does work across a shadow boundary.
   */
  private _describeTrigger = () => {
    const slot = this.renderRoot?.querySelector('slot:not([name])') as HTMLSlotElement | null;
    const text = this.content || (this.textContent ?? '').trim();
    for (const el of slot?.assignedElements({ flatten: true }) ?? []) {
      if (text) el.setAttribute('aria-description', text);
      else el.removeAttribute('aria-description');
    }
  };

  render() {
    return html`
      <span part="trigger"><slot @slotchange=${this._describeTrigger}></slot></span>
      <span part="tooltip" id=${this._tooltipId} role="tooltip">
        <!--
          Slotted content, falling back to \`title\`.

          A tooltip is usually a phrase, and a string prop is the right shape for a phrase. But some
          of what a tooltip is *for* does not fit in one — an avatar stack capped at five faces has
          to be able to say who the other seven are, and a list of faces and names is not a string.
          Reaching for \`we-popover\` instead would mean re-implementing hover and focus timing that
          already works here.

          Named, so it cannot collide with the trigger's default slot, and defaulting to \`title\` so
          every existing caller is untouched. Keep slotted content non-interactive: this lives in a
          \`role="tooltip"\`, which promises the reader there is nothing in here to operate.
        -->
        <slot name="content">${this.content}</slot>
        <span part="arrow"></span>
      </span>
    `;
  }
}
