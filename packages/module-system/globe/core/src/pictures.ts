/**
 * Pictures drawn for markers, on a canvas, for either engine to hand to its own image type.
 */

/** Four times over, for a sharp edge on a high-density screen. */
const OVERSAMPLE = 4;

const pictures = new Map<string, Promise<HTMLCanvasElement | null>>();

/**
 * A picture cut to a circle with a ring round it, `diameter` pixels across the ring included. Drawn
 * once per URL, size and ring and shared by every marker that shows it. Null when the image cannot be
 * loaded — the marker is then drawn as a dot.
 */
export function ringedPicture(
  url: string,
  diameter: number,
  ring: number,
  ringCss: string,
): Promise<HTMLCanvasElement | null> {
  const key = `${url}|${diameter}|${ring}|${ringCss}`;
  let pending = pictures.get(key);
  if (!pending) {
    pending = new Promise((resolve) => {
      const size = Math.ceil(diameter * OVERSAMPLE);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) return resolve(null);
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const radius = size / 2;
        const border = ring * OVERSAMPLE;
        if (border > 0) {
          context.beginPath();
          context.arc(radius, radius, radius, 0, Math.PI * 2);
          context.fillStyle = ringCss;
          context.fill();
        }
        context.save();
        context.beginPath();
        context.arc(radius, radius, radius - border, 0, Math.PI * 2);
        context.clip();
        context.drawImage(image, border, border, size - border * 2, size - border * 2);
        context.restore();
        resolve(canvas);
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
    pictures.set(key, pending);
  }
  return pending;
}

/** The scale a picture from {@link ringedPicture} was drawn at, so a renderer can show it at size. */
export const PICTURE_OVERSAMPLE = OVERSAMPLE;
