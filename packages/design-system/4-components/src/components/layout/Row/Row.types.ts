import type { FlexCrossAxis, FlexMainAxis } from '@we/design-types';
import type { LayoutProps } from '@we/design-utils/solid';

export type RowProps = Omit<LayoutProps, 'ax' | 'ay'> & { ax?: FlexMainAxis; ay?: FlexCrossAxis };
