export interface StepperStep {
  label: string;
  description?: string;
  icon?: string;
}

export interface StepperProps {
  steps?: StepperStep[];
  activeStep?: number;
  orientation?: 'horizontal' | 'vertical';
  styles?: Record<string, string | number>;
}
