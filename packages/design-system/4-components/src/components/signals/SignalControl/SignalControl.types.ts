export type SignalMode = 'toggle' | 'vote' | 'rating' | 'slider';

/** Structural subset of SignalType — any object with these fields is accepted */
export interface SignalTypeData {
  icon: string;
  iconSecondary?: string;
  rangeMin: number;
  rangeMax: number;
  step?: number;
  mode: SignalMode;
}

export interface SignalControlProps {
  signalType: SignalTypeData;
  /** The authenticated user's current signal value, or null if not yet signalled */
  myValue?: number | null;
  /** Pre-computed aggregate value to display (count, sum, mean, etc.) */
  aggregate?: number;
  onSignal?: (value: number) => void;
  disabled?: boolean;
  /**
   * When true the component manages its own internal value state so it can be
   * used as a standalone interactive preview without wiring up myValue/onSignal.
   */
  preview?: boolean;
  class?: string;
  styles?: Record<string, string | number>;
}
