/**
 * An imagery provider that draws only the land in its tiles.
 *
 * Landsat photographed the land and the coastal water with it. Its sea is a patchwork: solid black
 * where there was no scene, dark scenes of shallows elsewhere, the odd cloud, all in rectangles. Laid
 * over Blue Marble's ocean, every coastline sat in a ragged dark frame.
 *
 * Cesium cannot mask one imagery layer with another, so the mask is applied per tile, here. Each
 * tile is fetched with the matching tile of a land mask (land opaque, water transparent), and only
 * what the mask covers is kept. Where the mask stops short of the imagery's own levels, the parent
 * mask tile is scaled up, which softens the coastline a little at the closest zooms.
 *
 * A mask tile that fails (offline, or a gap in the mask) leaves the tile unmasked rather than
 * blank, since the land is the point of the layer.
 */
import { type ImageryTypes, type Request, UrlTemplateImageryProvider } from 'cesium';

export interface LandOnlyOptions extends UrlTemplateImageryProvider.ConstructorOptions {
  /** A land mask: land opaque, water transparent, in the same tiling scheme as the imagery. */
  mask: UrlTemplateImageryProvider;
  /** The deepest level the mask is served at. */
  maskMaximumLevel: number;
}

export class LandOnlyImageryProvider extends UrlTemplateImageryProvider {
  private readonly mask: UrlTemplateImageryProvider;
  private readonly maskMaximumLevel: number;

  constructor({ mask, maskMaximumLevel, ...options }: LandOnlyOptions) {
    super(options);
    this.mask = mask;
    this.maskMaximumLevel = maskMaximumLevel;
  }

  override requestImage(x: number, y: number, level: number, request?: Request): Promise<ImageryTypes> | undefined {
    // Undefined means Cesium throttled the request and will ask again; pass that straight through.
    const image = super.requestImage(x, y, level, request);
    if (!image) return undefined;

    const shift = Math.max(0, level - this.maskMaximumLevel);
    const maskX = x >> shift;
    const maskY = y >> shift;
    // Asked without a Request, so the mask is never throttled out from under a tile that was not.
    const mask = (this.mask.requestImage(maskX, maskY, level - shift) ?? Promise.reject()).catch(() => undefined);

    return Promise.all([image, mask]).then(([tile, maskTile]) => {
      if (!maskTile) return tile;
      const width = this.tileWidth;
      const height = this.tileHeight;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return tile;
      context.drawImage(tile as CanvasImageSource, 0, 0, width, height);
      // Keep only what the mask covers. The mask tile spans 2^shift tiles a side; this tile is one.
      context.globalCompositeOperation = 'destination-in';
      context.imageSmoothingEnabled = true;
      const span = 1 << shift;
      const source = maskTile as CanvasImageSource & { width: number; height: number };
      const cellWidth = source.width / span;
      const cellHeight = source.height / span;
      context.drawImage(
        source,
        (x - (maskX << shift)) * cellWidth,
        (y - (maskY << shift)) * cellHeight,
        cellWidth,
        cellHeight,
        0,
        0,
        width,
        height,
      );
      // Hand back the kind of image that came in. Cesium decodes tiles into ImageBitmaps already
      // flipped for upload and uploads them as they are, but flips a canvas on upload; returning the
      // canvas drawn from flipped bitmaps turned every tile upside down.
      return tile instanceof ImageBitmap ? createImageBitmap(canvas) : canvas;
    });
  }
}
