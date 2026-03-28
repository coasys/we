import type { Ad4mClient } from '@coasys/ad4m';
import type { Space } from '@we/models';

export interface CreateSpaceModalWidgetProps {
  adamClient: Ad4mClient | undefined;
  addNewSpace: (space: Space) => void;
  close: () => void;
  class?: string;
  style?: Record<string, string | number>;
}
