import { createSignal, onMount } from 'solid-js';

type BenchmarkTimerProps = {
  /** Callback to record the render duration */
  onComplete: (duration: number) => void;
  /** Label for this benchmark route */
  label?: string;
};

/**
 * BenchmarkTimer — placed as the FIRST child in a benchmark route.
 * Records performance.now() at creation time (before siblings render),
 * then measures elapsed time at onMount+rAF (after all siblings painted).
 *
 * This is self-contained — no external start signal needed.
 */
export function BenchmarkTimer(props: BenchmarkTimerProps) {
  const createdAt = performance.now();
  const [duration, setDuration] = createSignal<number | null>(null);

  onMount(() => {
    requestAnimationFrame(() => {
      const elapsed = performance.now() - createdAt;
      setDuration(elapsed);
      props.onComplete(elapsed);
    });
  });

  const label = () => (props.label ? `${props.label}: ` : '');
  const text = () => {
    const d = duration();
    return d !== null ? `${label()}${d.toFixed(1)}ms` : '';
  };

  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        padding: '8px 12px',
        'border-radius': '6px',
        background: 'var(--we-color-success-50, #f0fdf4)',
        border: '1px solid var(--we-color-success-200, #bbf7d0)',
        'margin-top': '12px',
      }}
    >
      <span style={{ color: 'var(--we-color-success-600, #16a34a)', 'font-weight': '600', 'font-size': '13px' }}>
        ✓ Rendered
      </span>
      <span style={{ color: 'var(--we-color-neutral-700, #374151)', 'font-size': '13px', 'font-family': 'monospace' }}>
        {text()}
      </span>
    </div>
  );
}
