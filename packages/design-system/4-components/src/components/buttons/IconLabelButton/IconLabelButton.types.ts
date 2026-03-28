import type { IconWeight } from '@we/primitives/types';

export interface IconLabelButtonProps {
  icon: string;
  label: string;
  selected?: boolean;
  iconWeight?: IconWeight;
  onClick?: () => void;
  class?: string;
  styles?: Record<string, string | number>;
}
