export interface ImageCropRef {
  /** Exports the current crop as a File. Resolves once canvas.toBlob completes. */
  getCroppedFile: () => Promise<File>;
}

export interface ImageCropProps {
  /** Object URL or data URL of the image to crop */
  src: string;
  /** Original filename used when constructing the output File */
  fileName?: string;
  /**
   * Aspect ratio for the crop box (width / height).
   * Default: 1 (square). Pass 0 for free-form (unconstrained).
   */
  aspect?: number;
  /** Maximum px on the longest output side. Default: unlimited. */
  maxSize?: number;
  /** MIME type for the output file. Default: 'image/jpeg'. */
  outputType?: string;
  /** Compression quality 0–1. Default: 0.9. */
  quality?: number;
  /**
   * Called once the image has loaded and the crop API is ready.
   * Use the returned ref to call getCroppedFile() imperatively.
   */
  onReady?: (ref: ImageCropRef) => void;
}
