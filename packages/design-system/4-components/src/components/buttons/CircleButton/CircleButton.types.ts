export interface CircleButtonProps {
  label: string;
  icon?: string;
  image?: string;
  onClick?: () => void;
  class?: string;
  styles?: Record<string, string | number>;
}
