import { Row } from '@we/components/solid';
import { onMount } from 'solid-js';

type BenchmarkTimerProps = {
  /** Callback to record the render duration and route name */
  onComplete: (duration: number, routeName: string) => void;
  /** Label / route name for this benchmark */
  label?: string;
};

/**
 * BenchmarkTimer — placed as the last child in a benchmark route.
 * Records performance.now() at creation time, then measures elapsed
 * time at onMount+rAF (after all siblings painted).
 *
 * The elapsed time is passed back via the `onComplete` callback so it
 * can be displayed elsewhere on the page (e.g. in a results summary).
 * This component itself only renders a "Rendered" confirmation badge.
 */
export function BenchmarkTimer(props: BenchmarkTimerProps) {
  const createdAt = performance.now();

  onMount(() => {
    requestAnimationFrame(() => {
      const elapsed = performance.now() - createdAt;
      props.onComplete(elapsed, props.label ?? '');
    });
  });

  const label = () => (props.label ? `${props.label} ` : '');

  return (
    <Row gap="200" ay="center" p="200" bg="success-50" r="300" mb="300">
      <we-icon name="check" color="success-600" size="sm" />
      <we-text color="success-700">Succesfully rendered</we-text>
      <we-text color="success-700" fontWeight="700">
        {label()}
      </we-text>
    </Row>
  );
}
