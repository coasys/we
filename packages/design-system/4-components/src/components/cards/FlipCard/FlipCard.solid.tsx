import { createSignal } from 'solid-js';

export type * from './FlipCard.types';
import type { FlipCardProps } from './FlipCard.types';

export function FlipCard(props: FlipCardProps) {
  const [flipped, setFlipped] = createSignal(false);

  const height = () => props.height ?? '220px';
  const flipOnHover = () => props.flipOnHover ?? false;
  const wobbleOnHover = () => props.wobbleOnHover ?? true;
  const wobbleDegree = () => props.wobbleDegree ?? 10;

  let innerRef: HTMLDivElement | undefined;

  function applyWobble() {
    if (!wobbleOnHover() || flipOnHover() || !innerRef) return;
    const base = flipped() ? 180 : 0;
    const direction = flipped() ? -1 : 1;
    innerRef.style.transform = `rotateY(${base + direction * wobbleDegree()}deg)`;
  }

  function resetWobble() {
    if (innerRef) innerRef.style.transform = '';
  }

  function handleClick() {
    if (flipOnHover()) return;
    resetWobble();
    setFlipped((f) => !f);
  }

  return (
    <div
      class={[
        'we-flip-card',
        flipped() && 'we-flip-card--flipped',
        flipOnHover() && 'we-flip-card--hover-flip',
        props.class,
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          height: height(),
          width: '100%',
          ...(props.flipDuration ? { '--we-flip-card-duration': props.flipDuration } : {}),
          ...props.styles,
        } as Record<string, string | number>
      }
      onClick={handleClick}
      onMouseEnter={applyWobble}
      onMouseLeave={resetWobble}
      role="button"
      aria-pressed={flipped()}
      tabIndex={0}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div ref={innerRef} class="we-flip-card__inner">
        <div class="we-flip-card__face we-flip-card__front">{props.front}</div>
        <div class="we-flip-card__face we-flip-card__back">{props.back}</div>
      </div>
    </div>
  );
}
