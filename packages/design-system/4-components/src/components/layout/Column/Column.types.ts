import type { FlexCrossAxis, FlexMainAxis } from '@we/design-types';
import type { LayoutProps } from '@we/design-utils/solid';

export type ColumnProps = Omit<LayoutProps, 'ax' | 'ay'> & { ax?: FlexCrossAxis; ay?: FlexMainAxis };
