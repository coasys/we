import { Row } from '@we/components/solid';
import { onMount } from 'solid-js';

/** Raw timestamps handed back to testStore, which derives the phase durations.
 *  Mirrors `BenchMarks` in testStore.ts. */
type BenchMarks = {
  createdAt: number;
  mountedAt: number;
  flushedAt: number;
  paintedAt: number;
  elements: number;
  customElements: number;
};

type BenchmarkTimerProps = {
  /** Receives the raw marks for this render. */
  onComplete: (marks: BenchMarks) => void;
  /** Label / route name for this benchmark */
  label?: string;
};

/**
 * BenchmarkTimer — placed as the last child in a benchmark route.
 *
 * A dumb probe: it stamps four checkpoints and hands them back raw, leaving the store to derive
 * durations. It deliberately does NOT know when navigation started, because it can't — its own body
 * runs only after every preceding sibling has been walked and built, which is precisely what makes
 * that first boundary measurable.
 *
 * The checkpoints, and what each interval isolates:
 *
 *   navigation ─▶ createdAt   schema walk, token resolution, detached DOM construction
 *   createdAt  ─▶ mountedAt   DOM insertion + custom-element upgrade
 *   mountedAt  ─▶ flushedAt   Lit's async first render and updated() hooks
 *   flushedAt  ─▶ paintedAt   style, layout, paint
 *
 * Two timing details this depends on:
 *
 * - Lit updates on a microtask, while Solid's onMount still runs inside the same synchronous task
 *   as construction. A `queueMicrotask` after onMount therefore lands after Lit has flushed its
 *   first render — which is what separates per-instance DS-prop work from the browser's paint.
 * - `requestAnimationFrame` fires *before* paint, not after. A single rAF (what this component
 *   previously used) excluded paint from the measurement entirely. The second rAF is the standard
 *   approximation for "the previous frame has been committed".
 */
export function BenchmarkTimer(props: BenchmarkTimerProps) {
  const createdAt = performance.now();

  onMount(() => {
    const mountedAt = performance.now();
    queueMicrotask(() => {
      const flushedAt = performance.now();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const paintedAt = performance.now();
          // Counted here rather than in the store so the counts describe the frame that was
          // actually measured. Single pass, both figures.
          const all = document.querySelectorAll('*');
          let customElements = 0;
          for (const el of all) if (el.tagName.includes('-')) customElements++;
          props.onComplete({ createdAt, mountedAt, flushedAt, paintedAt, elements: all.length, customElements });
        });
      });
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
