import { createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js';

export type * from './ImageCrop.types';
import { Column } from '../../layout/Column/Column.solid';
import { Row } from '../../layout/Row/Row.solid';
import type { ImageCropProps } from './ImageCrop.types';

// ── constants ─────────────────────────────────────────────────────────────────
const OVERLAY = 'rgba(0,0,0,0.55)';
const BORDER = 'rgba(255,255,255,0.9)';
const GRID = 'rgba(255,255,255,0.3)';

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Minimum zoom so the rotated image fully covers the crop box at centre.
 * Derived from requiring all 4 crop-box corners to lie inside the rotated image.
 */
function minZoomForCoverage(imgW: number, imgH: number, cropW: number, cropH: number, angleRad: number) {
  const cos = Math.abs(Math.cos(angleRad));
  const sin = Math.abs(Math.sin(angleRad));
  return Math.max((cropW * cos + cropH * sin) / imgW, (cropW * sin + cropH * cos) / imgH, 0.01);
}

// ── component ─────────────────────────────────────────────────────────────────
export function ImageCrop(allProps: ImageCropProps) {
  const aspect = () => (allProps.aspect === undefined ? 1 : allProps.aspect);
  const outputType = () => allProps.outputType ?? 'image/jpeg';
  const quality = () => allProps.quality ?? 0.9;
  // Canvas height shrinks for wide aspect ratios so the crop zone stays large
  // enough to interact with. Portrait/square images cap at 340px.
  const canvasHeight = createMemo(() => Math.max(120, Math.min(340, Math.round(680 / Math.max(aspect(), 0.25)))));

  let canvas!: HTMLCanvasElement;
  let container!: HTMLDivElement;
  const dpr = window.devicePixelRatio || 1;

  const img = new Image();

  // ── reactive state ──────────────────────────────────────────────────────────
  const [imgLoaded, setImgLoaded] = createSignal(false);
  const [canvasW, setCanvasW] = createSignal(0);
  const [zoom, setZoom] = createSignal(1);
  const [panX, setPanX] = createSignal(0);
  const [panY, setPanY] = createSignal(0);
  // Rotation stored as degrees to avoid float drift on the slider
  const [fineRotDeg, setFineRotDeg] = createSignal(0); // slider: −45…+45
  const [snapRotDeg, setSnapRotDeg] = createSignal(0); // 90° increments: 0|90|180|270
  const [flipH, setFlipH] = createSignal(false);
  const [flipV, setFlipV] = createSignal(false);

  const totalAngleRad = createMemo(() => ((fineRotDeg() + snapRotDeg()) * Math.PI) / 180);

  // ── crop box geometry ───────────────────────────────────────────────────────
  const cropSize = createMemo(() => {
    const W = canvasW();
    const H = canvasHeight();
    const ratio = aspect();
    if (ratio === 0) return { w: W * 0.8, h: H * 0.8 };
    const maxW = W * 0.85;
    const maxH = H * 0.85;
    return maxW / maxH > ratio ? { w: maxH * ratio, h: maxH } : { w: maxW, h: maxW / ratio };
  });
  const cropLeft = createMemo(() => (canvasW() - cropSize().w) / 2);
  const cropTop = createMemo(() => (canvasHeight() - cropSize().h) / 2);

  // Re-fit the image whenever the canvas is first measured or the image first loads,
  // whichever happens last. untrack prevents rotation-signal changes from re-triggering.
  createEffect(() => {
    if (imgLoaded() && canvasW() > 0) {
      untrack(() => resetToFit());
    }
  });

  // ── transform helpers ───────────────────────────────────────────────────────
  function getMinZoom() {
    return minZoomForCoverage(img.naturalWidth, img.naturalHeight, cropSize().w, cropSize().h, totalAngleRad());
  }

  /**
   * Exact pan clamp in the image's local coordinate frame.
   * Transforms pan into image-local axes, clamps so every crop-box corner
   * stays inside the image, then rotates back to world space.
   * Works correctly at any rotation angle — no AABB over-permissiveness.
   */
  function clampPan(px: number, py: number, z: number): [number, number] {
    const angle = totalAngleRad();
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const { w: cw, h: ch } = cropSize();
    const sx = flipH() ? -1 : 1;
    const sy = flipV() ? -1 : 1;

    // Coverage constraint involves sx*px and sy*py (flip-adjusted pan).
    // When a flip is active the draw transform is translate→scale(flip)→rotate,
    // so the effective local-frame pan is (sx*px, sy*py) not (px, py).
    const epx = sx * px;
    const epy = sy * py;

    // Transform effective pan to image-local frame
    const localX = epx * cos + epy * sin;
    const localY = -epx * sin + epy * cos;

    // Max reach of any crop-box corner along each local axis
    const extX = (cw / 2) * Math.abs(cos) + (ch / 2) * Math.abs(sin);
    const extY = (cw / 2) * Math.abs(sin) + (ch / 2) * Math.abs(cos);

    // How far the image centre can drift before a corner goes uncovered
    const limitX = Math.max(0, (img.naturalWidth * z) / 2 - extX);
    const limitY = Math.max(0, (img.naturalHeight * z) / 2 - extY);

    const clX = clamp(localX, -limitX, limitX);
    const clY = clamp(localY, -limitY, limitY);

    // Rotate clamped effective pan back to effective-pan space, then undo flip
    const clepx = clX * cos - clY * sin;
    const clepy = clX * sin + clY * cos;
    return [sx * clepx, sy * clepy];
  }

  function applyZoom(newZ: number) {
    const oldZ = zoom();
    const z = Math.max(newZ, getMinZoom());
    // Scale pan proportionally so the image point under the crop center stays fixed.
    const ratio = z / oldZ;
    const [cx, cy] = clampPan(panX() * ratio, panY() * ratio, z);
    setZoom(z);
    setPanX(cx);
    setPanY(cy);
  }

  function resetToFit() {
    const minZ = getMinZoom();
    setZoom(Math.max(cropSize().w / img.naturalWidth, cropSize().h / img.naturalHeight, minZ));
    setPanX(0);
    setPanY(0);
  }

  // ── draw ────────────────────────────────────────────────────────────────────
  createEffect(() => {
    if (!imgLoaded() || !canvasW()) return;

    const W = canvasW();
    const H = canvasHeight();
    const z = zoom();
    const px = panX();
    const py = panY();
    const angle = totalAngleRad();
    const { w: cw, h: ch } = cropSize();
    const cl = cropLeft();
    const ct = cropTop();

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Image
    ctx.save();
    ctx.translate(W / 2 + px, H / 2 + py);
    ctx.scale(flipH() ? -1 : 1, flipV() ? -1 : 1);
    ctx.rotate(angle);
    ctx.drawImage(
      img,
      (-img.naturalWidth * z) / 2,
      (-img.naturalHeight * z) / 2,
      img.naturalWidth * z,
      img.naturalHeight * z,
    );
    ctx.restore();

    // Dim overlay — four rects surrounding the crop box
    ctx.fillStyle = OVERLAY;
    ctx.fillRect(0, 0, W, ct);
    ctx.fillRect(0, ct + ch, W, H - ct - ch);
    ctx.fillRect(0, ct, cl, ch);
    ctx.fillRect(cl + cw, ct, W - cl - cw, ch);

    // Crop border
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cl, ct, cw, ch);

    // Rule-of-thirds grid
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(cl + (cw / 3) * i, ct);
      ctx.lineTo(cl + (cw / 3) * i, ct + ch);
      ctx.moveTo(cl, ct + (ch / 3) * i);
      ctx.lineTo(cl + cw, ct + (ch / 3) * i);
    }
    ctx.stroke();

    ctx.restore(); // DPR scale
  });

  // ── pointer pan ─────────────────────────────────────────────────────────────
  let drag: { x: number; y: number; px: number; py: number } | null = null;

  function onPointerDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, px: panX(), py: panY() };
  }
  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const [cx, cy] = clampPan(drag.px + e.clientX - drag.x, drag.py + e.clientY - drag.y, zoom());
    setPanX(cx);
    setPanY(cy);
  }
  function onPointerUp() {
    drag = null;
  }

  // ── wheel zoom ───────────────────────────────────────────────────────────────
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    applyZoom(zoom() * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }

  // ── pinch zoom ───────────────────────────────────────────────────────────────
  const ptrs = new Map<number, PointerEvent>();
  let pinchDist = 0;

  function onPinchDown(e: PointerEvent) {
    ptrs.set(e.pointerId, e);
  }
  function onPinchMove(e: PointerEvent) {
    ptrs.set(e.pointerId, e);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchDist > 0) applyZoom(zoom() * (d / pinchDist));
      pinchDist = d;
    }
  }
  function onPinchUp(e: PointerEvent) {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinchDist = 0;
  }

  // ── rotation ─────────────────────────────────────────────────────────────────
  function onSlider(e: Event) {
    const newDeg = Number((e as CustomEvent).detail);
    const oldAngle = ((fineRotDeg() + snapRotDeg()) * Math.PI) / 180;
    const newAngle = ((newDeg + snapRotDeg()) * Math.PI) / 180;
    const delta = newAngle - oldAngle;

    // Rotate the pan vector by the rotation delta so the image point currently
    // under the crop center stays fixed — i.e. rotation pivots around the crop zone.
    // When one axis is flipped (but not both), the effective rotation direction of
    // the pan correction inverts, hence multiplying sin terms by the flip sign product.
    const cos = Math.cos(delta);
    const sin = Math.sin(delta);
    const fSign = (flipH() ? -1 : 1) * (flipV() ? -1 : 1);
    const rpx = panX() * cos - fSign * panY() * sin;
    const rpy = fSign * panX() * sin + panY() * cos;

    setFineRotDeg(newDeg);
    const minZ = minZoomForCoverage(img.naturalWidth, img.naturalHeight, cropSize().w, cropSize().h, newAngle);
    setZoom((z) => Math.max(z, minZ));
    const [cx, cy] = clampPan(rpx, rpy, zoom());
    setPanX(cx);
    setPanY(cy);
  }

  function toggleFlipH() {
    setFlipH((v) => !v);
    const [cx, cy] = clampPan(panX(), panY(), zoom());
    setPanX(cx);
    setPanY(cy);
  }
  function toggleFlipV() {
    setFlipV((v) => !v);
    const [cx, cy] = clampPan(panX(), panY(), zoom());
    setPanX(cx);
    setPanY(cy);
  }

  function snapRotateLeft() {
    setSnapRotDeg((s) => (s - 90 + 360) % 360);
    setFineRotDeg(0);
    resetToFit();
  }

  function snapRotateRight() {
    setSnapRotDeg((s) => (s + 90) % 360);
    setFineRotDeg(0);
    resetToFit();
  }

  // ── export ────────────────────────────────────────────────────────────────────
  function getCroppedFile(): Promise<File> {
    const W = canvasW();
    const H = canvasHeight();
    const z = zoom();
    const px = panX();
    const py = panY();
    const angle = totalAngleRad();
    const { w: cw, h: ch } = cropSize();
    const cl = cropLeft();
    const ct = cropTop();

    // Offscreen canvas: big enough for any rotation, drawn at natural (1×) scale
    const offW = img.naturalWidth + img.naturalHeight;
    const offH = offW;
    const off = document.createElement('canvas');
    off.width = offW;
    off.height = offH;
    const octx = off.getContext('2d')!;
    octx.translate(offW / 2, offH / 2);
    octx.scale(flipH() ? -1 : 1, flipV() ? -1 : 1);
    octx.rotate(angle);
    octx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2, img.naturalWidth, img.naturalHeight);

    // Map crop box (canvas coords) → offscreen coords.
    // offX = (canvasX − imageCanvasCentre) / zoom + offW/2
    const srcX = (cl - (W / 2 + px)) / z + offW / 2;
    const srcY = (ct - (H / 2 + py)) / z + offH / 2;
    const srcW = cw / z;
    const srcH = ch / z;

    let outW = srcW;
    let outH = srcH;
    if (allProps.maxSize && Math.max(outW, outH) > allProps.maxSize) {
      const s = allProps.maxSize / Math.max(outW, outH);
      outW *= s;
      outH *= s;
    }
    outW = Math.round(outW);
    outH = Math.round(outH);

    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    out.getContext('2d')!.drawImage(off, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

    const type = outputType();
    const rawName = allProps.fileName ?? 'image';
    const ext = type.split('/')[1] ?? 'jpg';
    const baseName = rawName.replace(/\.[^.]+$/, '');

    return new Promise<File>((resolve, reject) => {
      out.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Canvas toBlob returned null'));
            return;
          }
          resolve(new File([blob], `${baseName}.${ext}`, { type }));
        },
        type,
        quality(),
      );
    });
  }

  // ── mount ─────────────────────────────────────────────────────────────────────
  onMount(() => {
    // Use ResizeObserver so we get the correct CSS width even when mounting inside
    // a modal whose layout isn't complete at the first paint.
    const ro = new ResizeObserver(([entry]) => {
      setCanvasW(entry.contentRect.width);
    });
    ro.observe(container);
    onCleanup(() => ro.disconnect());

    canvas.addEventListener('wheel', onWheel, { passive: false });
    onCleanup(() => canvas.removeEventListener('wheel', onWheel));

    img.onload = () => {
      setImgLoaded(true);
      allProps.onReady?.({ getCroppedFile });
    };
    img.src = allProps.src;
  });

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <Column
      ref={(el) => {
        container = el;
      }}
      gap="300"
      width="100%"
      ax="center"
    >
      <canvas
        ref={(el) => {
          canvas = el;
        }}
        width={canvasW() * dpr}
        height={canvasHeight() * dpr}
        style={{
          display: 'block',
          width: '100%',
          height: `${canvasHeight()}px`,
          cursor: 'grab',
          'touch-action': 'none',
          'border-radius': 'var(--we-radius-400)',
          background: 'var(--we-role-surface-sunken)',
        }}
        onPointerDown={(e) => {
          onPointerDown(e);
          onPinchDown(e);
        }}
        onPointerMove={(e) => {
          onPointerMove(e);
          onPinchMove(e);
        }}
        onPointerUp={(e) => {
          onPointerUp();
          onPinchUp(e);
        }}
        onPointerLeave={(e) => {
          onPointerUp();
          onPinchUp(e);
        }}
      />

      {/* Rotation and flip controls */}
      <Row ay="center" gap="300">
        <we-tooltip title="Flip horizontal">
          <we-button size="md" square variant="ghost" onClick={toggleFlipH}>
            <we-icon name="flip-horizontal" />
          </we-button>
        </we-tooltip>

        <we-tooltip title="Rotate left 90°">
          <we-button size="md" square variant="ghost" onClick={snapRotateLeft}>
            <we-icon name="arrow-counter-clockwise" />
          </we-button>
        </we-tooltip>

        <Column ax="center">
          <we-slider mt="24px" min={-45} max={45} step={0.5} value={fineRotDeg()} on:input={onSlider} />
          <we-text mt="10px" fontSize="300" color="text-muted">
            {fineRotDeg() > 0 ? `+${fineRotDeg()}°` : `${fineRotDeg()}°`}
          </we-text>
        </Column>

        <we-tooltip title="Rotate right 90°">
          <we-button size="md" square variant="ghost" onClick={snapRotateRight}>
            <we-icon name="arrow-clockwise" />
          </we-button>
        </we-tooltip>

        <we-tooltip title="Flip vertical">
          <we-button size="md" square variant="ghost" onClick={toggleFlipV}>
            <we-icon name="flip-vertical" />
          </we-button>
        </we-tooltip>
      </Row>
    </Column>
  );
}
