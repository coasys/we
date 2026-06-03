import type { JSX } from 'solid-js';

export interface FlipCardProps {
  /** Rendered into the front face — pass schema content via the `slots.front` field */
  front?: JSX.Element;
  /** Rendered into the back face — pass schema content via the `slots.back` field */
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
