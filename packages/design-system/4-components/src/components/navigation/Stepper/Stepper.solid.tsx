import { For, Show } from 'solid-js';

export type * from './Stepper.types';
import type { StepperProps } from './Stepper.types';

interface SolidStepperProps extends StepperProps {
  onStepClick?: (index: number) => void;
}

export function Stepper(props: SolidStepperProps) {
  const steps = () => props.steps || [];
  const activeStep = () => props.activeStep ?? 0;
  const orientation = () => props.orientation || 'horizontal';

  const indicatorClass = (i: number) => {
    if (i < activeStep()) return 'we-stepper__indicator--completed';
    if (i === activeStep()) return 'we-stepper__indicator--active';
    return 'we-stepper__indicator--pending';
  };

  return (
    <div
      class={`we-stepper${orientation() === 'vertical' ? ' we-stepper--vertical' : ''}`}
      role="list"
      style={props.styles}
    >
      <For each={steps()}>
        {(step, i) => (
          <>
            <div class="we-stepper__step" role="listitem">
              <div class={`we-stepper__indicator ${indicatorClass(i())}`} onClick={() => props.onStepClick?.(i())}>
                {i() < activeStep() ? (
                  <we-icon name="check" size="16px" />
                ) : step.icon ? (
                  <we-icon name={step.icon} size="16px" />
                ) : (
                  i() + 1
                )}
              </div>
              <div class="we-stepper__info">
                <span class="we-stepper__label">{step.label}</span>
                <Show when={step.description}>
                  <span class="we-stepper__description">{step.description}</span>
                </Show>
              </div>
            </div>
            {i() < steps().length - 1 && (
              <div
                class={`we-stepper__connector ${i() < activeStep() ? 'we-stepper__connector--completed' : 'we-stepper__connector--pending'}`}
              />
            )}
          </>
        )}
      </For>
    </div>
  );
}
