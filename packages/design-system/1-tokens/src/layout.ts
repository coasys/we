export type LayoutToken = 'xs' | 'sm' | 'md' | 'lg';

export const layout = {
  xs: '420px', // narrow modals, auth forms
  sm: '640px', // standard modals, forms
  md: '900px', // content columns
  lg: '1200px', // full-width page containers
} satisfies Record<LayoutToken, string>;
