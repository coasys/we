import type { Signal } from '../entities/Signal';
import type { SignalType } from '../entities/SignalType';

export function aggregateSignals(signals: Signal[], signalType: SignalType): number {
  const values = signals.map((s) => s.value);
  switch (signalType.aggregate) {
    case 'count':
      return values.length;
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'mean':
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
  }
}
