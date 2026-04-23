import { createSignal } from 'solid-js';

import { Column } from '../../layout/Column/Column.solid';
export type * from './FlipCard.types';
import type { FlipCardProps } from './FlipCard.types';

export function FlipCard(props: FlipCardProps) {
  const [flipped, setFlipped] = createSignal(false);
  const height = () => props.height ?? '220px';

  return (
    // Perspective wrapper — must be a plain div; `perspective` is not a design system prop
    <div
      class={`we-flip-card${flipped() ? ' we-flip-card--flipped' : ''}${props.class ? ` ${props.class}` : ''}`}
      style={{ height: height(), width: '100%', ...props.styles }}
      onClick={() => setFlipped((f) => !f)}
      role="button"
      aria-pressed={flipped()}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setFlipped((f) => !f);
        }
      }}
    >
      {/* Inner — must be a plain div; `transform-style: preserve-3d` is not a design system prop */}
      <div class="we-flip-card__inner">
        {/* Front face — Column handles flex-column layout; absolute positioning via styles */}
        <Column
          class="we-flip-card__face we-flip-card__front"
          gap="300"
          p="500"
          r="lg"
          bg="neutral-100"
          styles={{
            position: 'absolute',
            inset: '0',
            'backface-visibility': 'hidden',
            '-webkit-backface-visibility': 'hidden',
            border: '1px solid var(--we-color-neutral-200)',
            overflow: 'hidden',
          }}
        >
          {props.front.icon && <we-icon name={props.front.icon} size="xl" color="primary-500" />}
          <we-text
            class="we-flip-card__front-title"
            tag="span"
            fontSize="600"
            fontWeight="semibold"
            color="neutral-900"
            styles={{ 'line-height': '1.3', 'flex-shrink': '0' }}
          >
            {props.front.title}
          </we-text>
          <we-text tag="span" fontSize="400" color="neutral-600" styles={{ 'line-height': '1.6' }}>
            {props.front.body}
          </we-text>
          <we-text
            class="we-flip-card__flip-hint"
            tag="span"
            fontSize="300"
            color="neutral-400"
            aria-hidden="true"
            styles={{ 'margin-top': 'auto' }}
          >
            tap to flip →
          </we-text>
        </Column>

        {/* Back face — Column handles flex-column layout; 3D back-face transform via styles */}
        <Column
          class="we-flip-card__face we-flip-card__back"
          gap="300"
          p="500"
          r="lg"
          ay="center"
          styles={{
            position: 'absolute',
            inset: '0',
            'backface-visibility': 'hidden',
            '-webkit-backface-visibility': 'hidden',
            transform: 'rotateY(180deg)',
            background: 'var(--we-gradient-primary)',
            overflow: 'hidden',
          }}
        >
          {props.back.icon && <we-icon name={props.back.icon} size="xl" color="primary-100" />}
          <we-text tag="span" fontSize="400" color="primary-100" styles={{ 'line-height': '1.6' }}>
            {props.back.body}
          </we-text>
        </Column>
      </div>
    </div>
  );
}
