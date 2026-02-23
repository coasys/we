import { useEffect, useState } from 'react';

import { usePerspective } from '../context/PerspectiveContext';
import type { ScenarioModule, TestResult } from './types';

type RunState = 'idle' | 'running' | 'done';

type Props = {
  scenario: ScenarioModule;
  onRunReady?: (fn: () => Promise<void>) => void;
};

const STUB_COLOR = '#555';
const PASS_COLOR = '#4ade80';
const FAIL_COLOR = '#f87171';

function resultColor(r: TestResult): string {
  if (r.passed) return PASS_COLOR;
  if (r.error === 'Not yet implemented') return STUB_COLOR;
  return FAIL_COLOR;
}

function resultIcon(r: TestResult): string {
  if (r.passed) return '✓';
  if (r.error === 'Not yet implemented') return '○';
  return '✗';
}

export function ScenarioRunner({ scenario, onRunReady }: Props) {
  const perspective = usePerspective();
  const [runState, setRunState] = useState<RunState>('idle');
  const [results, setResults] = useState<TestResult[]>([]);

  async function run() {
    setRunState('running');
    setResults([]);
    const start = Date.now();
    try {
      const r = await scenario.run(perspective);
      setResults(r);
    } catch (e) {
      setResults([
        {
          name: 'Scenario threw unexpectedly',
          passed: false,
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        },
      ]);
    }
    setRunState('done');
  }

  // Expose run() to parent for "run all" orchestration
  useEffect(() => {
    onRunReady?.(run);
  }, []);

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const implemented = results.filter((r) => r.error !== 'Not yet implemented').length;

  return (
    <div
      style={{
        border: '1px solid #2a2a2a',
        borderRadius: 6,
        marginBottom: 10,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          background: '#1a1a1a',
        }}
      >
        <span style={{ flex: 1, fontWeight: 600 }}>{scenario.name}</span>

        {runState === 'done' && implemented > 0 && (
          <span style={{ color: passed === implemented ? PASS_COLOR : FAIL_COLOR, fontSize: 12 }}>
            {passed}/{implemented} passed
          </span>
        )}
        {runState === 'done' && implemented === 0 && (
          <span style={{ color: STUB_COLOR, fontSize: 12 }}>not yet implemented</span>
        )}

        <button onClick={run} disabled={runState === 'running'}>
          {runState === 'running' ? 'Running…' : runState === 'done' ? 'Re-run' : 'Run'}
        </button>
      </div>

      {results.length > 0 && (
        <ul style={{ margin: 0, padding: '8px 14px 10px 14px', listStyle: 'none' }}>
          {results.map((r, i) => (
            <li key={i} style={{ color: resultColor(r), padding: '2px 0', fontSize: 13 }}>
              {resultIcon(r)} {r.name}
              {r.error && r.error !== 'Not yet implemented' && (
                <span style={{ color: '#666', marginLeft: 8 }}>{r.error}</span>
              )}
              {r.passed && r.durationMs > 0 && <span style={{ color: '#444', marginLeft: 8 }}>{r.durationMs}ms</span>}
            </li>
          ))}
        </ul>
      )}

      {/* Show stub count before first run */}
      {runState === 'idle' && (
        <div style={{ padding: '6px 14px 8px', color: STUB_COLOR, fontSize: 12 }}>
          {total === 0 ? 'Click Run to execute' : `${total} tests`}
        </div>
      )}
    </div>
  );
}
