export interface FlipCardProps {
  /** Content shown on the front face */
  front: {
    /** Phosphor icon name shown on the front face */
    icon?: string;
    title: string;
    body: string;
  };
  /** Content shown on the back face */
  back: {
    /** Phosphor icon name shown on the back face */
    icon?: string;
    body: string;
  };
  /** Card height — defaults to 220px */
  height?: string;
  class?: string;
  styles?: Record<string, string | number>;
}
