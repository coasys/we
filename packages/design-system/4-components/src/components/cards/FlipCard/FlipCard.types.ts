import type { JSX } from 'solid-js';

export interface FlipCardProps {
  /** Rendered into the front face. A node prop: a template writes a node here and it arrives drawn. */
  front?: JSX.Element;
  /** Rendered into the back face. A node prop, as `front` is. */
  back?: JSX.Element;
  /** Card width — defaults to '100%' */
  width?: string;
  /** Card height — defaults to '220px' */
  height?: string;
  /** Flip on hover instead of click (default: false) */
  flipOnHover?: boolean;
  /** CSS transition duration for the flip animation (default: '0.5s') */
  flipDuration?: string;
  /** Wobble card toward the cursor on hover when not flipped (default: true) */
  wobbleOnHover?: boolean;
  /** Maximum tilt angle in degrees for the wobble effect (default: 10) */
  wobbleDegree?: number;
  class?: string;
  styles?: Record<string, string | number>;
}
