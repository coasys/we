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
  /** Callback when a new image is selected and cropped */
  onImageChange?: (file: File) => void;
  /**
   * Clear the current image. Omit it and no remove control appears — the component cannot clear
   * the image itself, since `src` is owned by whoever passes it.
   */
  onImageRemove?: () => void;
  /**
   * Hover label while there is no image. Default: "Upload image".
   *
   * Two labels rather than one subject slotted into "Upload {x}" / "Change {x}": that builds
   * English word order into the component, and plenty of languages inflect the noun after a verb
   * or put the verb elsewhere. Overriding only one is also common — a call site may want "Upload a
   * cover photo" and be content with plain "Edit image" afterwards.
   *
   * Distinct from `alt`, which describes the image to a screen reader rather than naming the
   * action. The two diverge as soon as a label wants to say something like "Choose a banner".
   */
  uploadLabel?: string;
  /**
   * Hover label once an image is set. Default: "Edit image".
   *
   * Neither label takes a size prop: the overlay's text leaves `fontSize` unset, so it inherits
   * from this component's own `fontSize` DS prop. A small tile shrinks its label without the
   * component growing an API for it.
   */
  editLabel?: string;
  /** Additional CSS class */
  class?: string;
  /**
   * Crop aspect ratio (width / height). Default: 1 (square).
   * Pass e.g. 16/9 for widescreen. Pass 0 for free-form.
   */
  aspect?: number;
  /** Maximum px on the longest output side. Default: unlimited. */
  maxSize?: number;
}
