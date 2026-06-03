import { useRef, useState } from 'react';

import { usePerspective } from '../context/PerspectiveContext';
import { scenarios } from '../scenarios';
import { ScenarioRunner } from './ScenarioRunner';

export function ScenarioList() {
  const perspective = usePerspective();
  const [runningAll, setRunningAll] = useState(false);
  // Expose a run trigger per scenario so "Run all" can fire them in sequence
  const runRefs = useRef<Array<() => Promise<void>>>([]);
  const clearRefs = useRef<Array<() => void>>([]);

  async function runAll() {
    setRunningAll(true);
    // Clear all results at once before any scenario starts
    for (const clear of clearRefs.current) clear();
    for (const run of runRefs.current) {
      await run();
    }
    setRunningAll(false);
  }

  return (
    <div style={{ padding: '24px', maxWidth: 760, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: '1px solid #2a2a2a',
        }}
      >
        <div>
          <h1>AD4M Model Test Harness</h1>
          <div style={{ color: '#555', fontSize: 12, marginTop: 4 }}>
            Perspective: <span style={{ color: '#888' }}>{perspective.name}</span>
            {' · '}
            <span style={{ color: '#888' }}>{perspective.uuid}</span>
          </div>
        </div>

        <button onClick={runAll} disabled={runningAll}>
          {runningAll ? 'Running all…' : 'Run all'}
        </button>
      </div>

      {scenarios.map((scenario, i) => (
        <ScenarioRunner
          key={scenario.name}
          scenario={scenario}
          onRunReady={(fn) => {
            runRefs.current[i] = fn;
          }}
          onClearReady={(fn) => {
            clearRefs.current[i] = fn;
          }}
        />
      ))}
    </div>
  );
}
