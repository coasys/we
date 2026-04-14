import type { DesignSystemProps } from '@we/design-types';

export interface EditableImageProps extends Partial<DesignSystemProps> {
  /** Current image source URL or data URI */
  src?: string;
  /** Alt text for the image */
  alt?: string;
  /** Object-fit mode */
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  /** Placeholder icon name when no image is set */
  placeholderIcon?: string;
  /** Callback when a new image is selected */
  onImageChange?: (file: File) => void;
  /** Additional CSS class */
  class?: string;
}
