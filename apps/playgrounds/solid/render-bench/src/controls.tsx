/**
 * The hand-written rungs of the ladder.
 *
 * Each renders exactly what `wcCard` in fixtures.ts produces, using one less layer of the stack:
 *
 *   RawDomCards       document.createElement + inline styles   — no framework, no design system
 *   PlainSolidCards   Solid JSX over plain elements            — no design system
 *   HandWrittenCards  Solid JSX over <Column> / <we-text>      — what a developer writes today
 *
 * The difference between adjacent rungs is that layer's cost. `tests/ladder.test.tsx` asserts they
 * stay equivalent, because a silent divergence would make every published ratio wrong while still
 * looking plausible.
 *
 * EQUIVALENCE IS STRUCTURAL, NOT FUNCTIONAL. The first two render the same shape with similar
 * styling via the same tokens, but deliberately lack what the design system provides: theming,
 * hover/focus/active states, shadow-DOM encapsulation, and any accessibility affordance beyond a
 * bare <button>. "Raw DOM is faster" always means "faster, and missing all of that".
 */
// '/solid' rather than the bare entry: it carries the JSX type declarations for we-* elements
// (module augmentation of solid-js) as well as the side effect that defines them.
import '@we/primitives/solid';

import { Column, Row } from '@we/components/solid';
import type { JSX } from 'solid-js';

import { LADDER_COUNT, postContent, REALISTIC_COUNT } from './fixtures';

const ids = () => Array.from({ length: LADDER_COUNT }, (_, i) => i + 1);

/** Visual equivalent of <Column p="200" gap="200" bg="neutral-0" r="200">. */
const CARD_STYLE =
  'display:flex;flex-direction:column;padding:var(--we-space-200);gap:var(--we-space-200);' +
  'background:var(--we-color-neutral-0);border-radius:var(--we-radius-200)';

/** Visual equivalent of <we-text fontSize="300" color="neutral-700">. */
const TEXT_STYLE = 'font-size:var(--we-font-300);color:var(--we-color-neutral-700)';

/** Rough visual equivalent of <we-button variant="outline" size="sm">. */
const BUTTON_STYLE =
  'display:inline-flex;align-items:center;justify-content:center;height:2rem;' +
  'padding:0 var(--we-space-200);border:1px solid var(--we-color-neutral-200);' +
  'border-radius:var(--we-radius-200);background:transparent;font-size:var(--we-font-200);' +
  'color:var(--we-color-neutral-800);cursor:pointer';

const GRID_STYLE = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));gap:6px';

/**
 * The floor. Returns a real element rather than JSX so construction happens synchronously in the
 * component body — inside the measured Build phase. Building it in onMount instead would charge the
 * work to Mount and misattribute the whole comparison.
 */
export function RawDomCards(): JSX.Element {
  const grid = document.createElement('div');
  grid.setAttribute('style', GRID_STYLE);

  for (const id of ids()) {
    const card = document.createElement('div');
    card.setAttribute('style', CARD_STYLE);

    const text = document.createElement('span');
    text.setAttribute('style', TEXT_STYLE);
    text.textContent = `WC ${id}`;
    card.appendChild(text);

    const button = document.createElement('button');
    button.setAttribute('style', BUTTON_STYLE);
    button.textContent = `Action ${id}`;
    card.appendChild(button);

    grid.appendChild(card);
  }
  return grid;
}

/** Solid's compiled template cloning over the same plain elements. */
export function PlainSolidCards(): JSX.Element {
  return (
    <div style={GRID_STYLE}>
      {ids().map((id) => (
        <div style={CARD_STYLE}>
          <span style={TEXT_STYLE}>WC {id}</span>
          <button style={BUTTON_STYLE}>Action {id}</button>
        </div>
      ))}
    </div>
  );
}

/**
 * What a developer writes today: real design-system components, plain JSX attributes, `.map()` for
 * a static list.
 *
 * Whether the plain-attribute form handicaps this control is a fair question — see
 * `HandWrittenCardsPropBound` below, which answers it by measurement rather than assertion.
 */
export function HandWrittenCards(): JSX.Element {
  return (
    <Column
      gap="200"
      styles={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' }}
    >
      {ids().map((id) => (
        <Column p="200" gap="200" bg="neutral-0" r="200">
          <we-text text={`WC ${id}`} fontSize="300" color="neutral-700" />
          <we-button text={`Action ${id}`} variant="outline" size="sm" />
        </Column>
      ))}
    </Column>
  );
}

/**
 * The same cards, binding design-system props as DOM **properties** via Solid's `prop:` directive
 * rather than as HTML attributes.
 *
 * Exists so the ladder is not open to the charge that its hand-written rung was written badly.
 * `<we-text text={…}>` sets an attribute, which Lit round-trips through `attributeChangedCallback`
 * → converter → property → update request; the schema renderer skips that by assigning the property
 * directly. If that mattered, the fair control would be this one and the published template tax
 * would be overstated.
 *
 * Note the `@ts-expect-error` on each element. The generated Solid declarations emit `prop:`
 * variants only for the four object-valued state props (`hoverProps`, `activeProps`, `focusProps`,
 * `disabledProps`) — the ones where a property binding is *required* because they cannot be
 * serialised to an attribute. Regular design-system props have no `prop:` variant, so this binding
 * is not expressible without a cast: a developer following the types is steered onto the attribute
 * path. That is a deliberate generator decision rather than an oversight, and only worth revisiting
 * if the measurement shows a meaningful gap.
 */
export function HandWrittenCardsPropBound(): JSX.Element {
  return (
    <Column
      gap="200"
      styles={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' }}
    >
      {ids().map((id) => (
        <Column p="200" gap="200" bg="neutral-0" r="200">
          {/* @ts-expect-error `prop:` is not emitted for regular DS props — see the note above. */}
          <we-text prop:text={`WC ${id}`} prop:fontSize="300" prop:color="neutral-700" />
          {/* @ts-expect-error `prop:` is not emitted for regular DS props — see the note above. */}
          <we-button prop:text={`Action ${id}`} prop:variant="outline" prop:size="sm" />
        </Column>
      ))}
    </Column>
  );
}

// ---------------------------------------------------------------------------
// Realistic ladder — the same rungs on page-shaped content
// ---------------------------------------------------------------------------

const postIds = () => Array.from({ length: REALISTIC_COUNT }, (_, i) => i + 1);

const REALISTIC_GRID = {
  display: 'grid',
  'grid-template-columns': 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: '12px',
};

/**
 * Hand-written equivalent of `realisticCard` — four component types, three levels of nesting, and
 * content that varies per card.
 *
 * Must stay a faithful mirror of the schema fixture; `tests/ladder.test.tsx` asserts it does.
 */
export function RealisticCards(): JSX.Element {
  return (
    <Column gap="200" styles={REALISTIC_GRID}>
      {postIds().map((id) => {
        const c = postContent(id);
        return (
          <Column p="300" gap="200" bg="neutral-0" r="300" border="1px solid neutral-200">
            <Row gap="200" ay="center">
              <we-avatar initials={c.initials} size="sm" />
              <Column gap="0">
                <we-text text={c.author} fontWeight="600" color="neutral-800" />
                <we-text text={c.time} fontSize="200" color="neutral-400" />
              </Column>
              <we-badge variant={c.badge as 'primary'} size="sm">
                {c.badgeLabel}
              </we-badge>
            </Row>
            <we-text text={c.title} fontSize="400" fontWeight="600" color="neutral-900" />
            <we-text text={c.body} fontSize="300" color="neutral-600" />
            <Row gap="300" ay="center">
              <we-button variant="ghost" size="sm">
                <we-icon name="heart" />
              </we-button>
              <we-text text={c.likes} fontSize="200" color="neutral-500" />
              <we-button variant="ghost" size="sm">
                <we-icon name="chat-circle" />
              </we-button>
              <we-text text={c.comments} fontSize="200" color="neutral-500" />
            </Row>
          </Column>
        );
      })}
    </Column>
  );
}

/** The same again, binding design-system props as properties. See `HandWrittenCardsPropBound`. */
export function RealisticCardsPropBound(): JSX.Element {
  return (
    <Column gap="200" styles={REALISTIC_GRID}>
      {postIds().map((id) => {
        const c = postContent(id);
        return (
          <Column p="300" gap="200" bg="neutral-0" r="300" border="1px solid neutral-200">
            <Row gap="200" ay="center">
              {/* @ts-expect-error `prop:` is not emitted for regular DS props — see the note above. */}
              <we-avatar prop:initials={c.initials} prop:size="sm" />
              <Column gap="0">
                {/* @ts-expect-error `prop:` is not emitted for regular DS props. */}
                <we-text prop:text={c.author} prop:fontWeight="600" prop:color="neutral-800" />
                {/* @ts-expect-error `prop:` is not emitted for regular DS props. */}
                <we-text prop:text={c.time} prop:fontSize="200" prop:color="neutral-400" />
              </Column>
              {/* @ts-expect-error `prop:` is not emitted for regular DS props. */}
              <we-badge prop:variant={c.badge} prop:size="sm">
                {c.badgeLabel}
              </we-badge>
            </Row>
            {/* @ts-expect-error `prop:` is not emitted for regular DS props. */}
            <we-text prop:text={c.title} prop:fontSize="400" prop:fontWeight="600" prop:color="neutral-900" />
            {/* @ts-expect-error `prop:` is not emitted for regular DS props. */}
            <we-text prop:text={c.body} prop:fontSize="300" prop:color="neutral-600" />
            <Row gap="300" ay="center">
              {/* @ts-expect-error `prop:` is not emitted for regular DS props. */}
              <we-button prop:variant="ghost" prop:size="sm">
                <we-icon name="heart" />
              </we-button>
              {/* @ts-expect-error `prop:` is not emitted for regular DS props. */}
              <we-text prop:text={c.likes} prop:fontSize="200" prop:color="neutral-500" />
              {/* @ts-expect-error `prop:` is not emitted for regular DS props. */}
              <we-button prop:variant="ghost" prop:size="sm">
                <we-icon name="chat-circle" />
              </we-button>
              {/* @ts-expect-error `prop:` is not emitted for regular DS props. */}
              <we-text prop:text={c.comments} prop:fontSize="200" prop:color="neutral-500" />
            </Row>
          </Column>
        );
      })}
    </Column>
  );
}

export const controls: Record<string, () => JSX.Element> = {
  RawDomCards,
  PlainSolidCards,
  HandWrittenCards,
  HandWrittenCardsPropBound,
  RealisticCards,
  RealisticCardsPropBound,
};
