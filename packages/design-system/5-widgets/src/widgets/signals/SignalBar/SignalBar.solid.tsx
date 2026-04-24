export type * from './SignalBar.types';

import { For } from 'solid-js';
import { SignalControl } from '@we/components/solid';
import type { SignalBarProps, SignalBarTypeConfig, SignalTypeState } from './SignalBar.types';

const DEFAULT_STATE: SignalTypeState = { myValue: null, aggregate: 0 };

export function SignalBar(props: SignalBarProps) {
  function stateFor(index: number): SignalTypeState {
    return props.state?.[index] ?? DEFAULT_STATE;
  }

  function handleSignal(type: SignalBarTypeConfig, value: number) {
    // No-op in preview mode (type has no persisted id)
    if (!type.id) return;
    props.onSignal?.(type, value);
  }

  return (
    <div class={`signal-bar ${props.class || ''}`} style={props.styles}>
      <For each={props.signalTypes}>
        {(signalType, index) => (
          <SignalControl
            signalType={signalType}
            myValue={stateFor(index()).myValue}
            aggregate={stateFor(index()).aggregate}
            onSignal={(value) => handleSignal(signalType, value)}
          />
        )}
      </For>
    </div>
  );
}
