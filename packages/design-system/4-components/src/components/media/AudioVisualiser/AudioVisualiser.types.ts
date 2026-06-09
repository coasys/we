export interface AudioVisualiserProps {
  /** Audio source — URL, blob URL, or data URI */
  src: string | undefined;
  /** Number of waveform bars. Default: 80 */
  bars?: number;
  /** Canvas height in px. Default: 48 */
  height?: number;
  /** CSS color for unplayed bars. Default: var(--we-color-neutral-300) */
  color?: string;
  /** CSS color for played bars and dynamic frequency bars. Default: var(--we-color-primary-400) */
  activeColor?: string;
}
