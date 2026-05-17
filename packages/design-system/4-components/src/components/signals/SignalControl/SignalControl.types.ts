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

/** Minimal shape expected from a Signal record */
export interface SignalData {
  signalTypeId: string;
  value: number;
  author: string;
}

export interface SignalControlProps {
  signalType: SignalTypeData;
  /**
   * All signals attached to the parent entity for this signalType.
   * SignalControl computes myValue and aggregate internally from this array.
   */
  signals?: SignalData[];
  /** DID of the current user — used to derive myValue from signals */
  myDid?: string;
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
