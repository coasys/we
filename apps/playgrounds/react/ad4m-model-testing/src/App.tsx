import type { PerspectiveProxy } from '@coasys/ad4m';
import { getAd4mClient } from '@coasys/ad4m-connect';
import { useEffect, useState } from 'react';

import { PerspectiveContext } from './context/PerspectiveContext';
import { ScenarioList } from './harness/ScenarioList';

type AppState = 'idle' | 'connecting' | 'connected' | 'error';

const TEST_PERSPECTIVE_NAME = 'ad4m-model-test';

export function App() {
  const [state, setState] = useState<AppState>('idle');
  const [perspective, setPerspective] = useState<PerspectiveProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function connect() {
      setState('connecting');
      try {
        const client = await getAd4mClient({
          appInfo: {
            name: 'AD4M Model Test',
            description: 'Model refactor integration test harness',
            url: 'localhost',
            iconPath: '',
          },
          capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
        });

        // Find or create the dedicated test perspective
        const all = await client.perspective.all();
        let p = all.find((x) => x.name === TEST_PERSPECTIVE_NAME) ?? null;
        if (!p) {
          p = await client.perspective.add(TEST_PERSPECTIVE_NAME);
        }

        setPerspective(p);
        setState('connected');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setState('error');
      }
    }

    connect();
  }, []);

  if (state === 'connected' && perspective) {
    return (
      <PerspectiveContext.Provider value={perspective}>
        <ScenarioList />
      </PerspectiveContext.Provider>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 600 }}>
      <h1>AD4M Model Test Harness</h1>
      {state === 'connecting' && <p style={{ color: '#888' }}>Connecting…</p>}
      {state === 'error' && <p style={{ color: '#f87171' }}>Connection failed: {error}</p>}
    </div>
  );
}
