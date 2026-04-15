import type { PerspectiveProxy } from '@coasys/ad4m';

/**
 * Represents a serialized block node (e.g., from Lexical editor state JSON).
 * This is the intermediate format between editor state and AD4M block models.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SerializedBlockNode = any;

export type BlockComposerProps = {
  post?: SerializedBlockNode;
  perspective?: PerspectiveProxy;
  onSave?: (json: SerializedBlockNode) => void;
};
