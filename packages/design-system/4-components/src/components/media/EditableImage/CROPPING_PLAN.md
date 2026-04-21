# Image Cropping — Implementation Plan

## Approach summary

Add an `ImageCrop` SolidJS component (level 4, alongside `EditableImage`) that handles
interactive crop/zoom on a canvas. Wire it into `EditableImage` as a second step after
file selection so the full flow becomes:

```
Drop/select file → Crop step → Confirm → onImageChange(croppedFile)
```

No third-party library — cropperjs adds ~50 kB and ships its own DOM. A canvas-based
implementation is ~100 lines and gives full control over output format/quality.

---

## Files to create / modify

### New: `ImageCrop.solid.tsx`
`packages/design-system/4-components/src/components/media/ImageCrop/ImageCrop.solid.tsx`

A self-contained SolidJS component that:
- Accepts `src: string` (object URL or data URL) and `aspect?: number` (e.g. `1` for square, `16/9`, etc — unconstrained if omitted)
- Renders a fixed-height canvas preview with a draggable/zoomable crop box
- Exposes `getCroppedFile(): Promise<File>` via a ref/callback so the parent can trigger export

Implementation approach:
- Draw the image onto a `<canvas>` with pointer events for drag + pinch/wheel zoom
- Overlay a crop rect (drawn as a semi-transparent mask)
- On confirm, draw the cropped region into a second off-screen canvas and call `canvas.toBlob()` to produce the output `File`

Props:
```ts
interface ImageCropProps {
  src: string;          // Object URL of the raw file
  aspect?: number;      // Aspect ratio (default: 1 — square). Unconstrained if explicitly set to 0.
  maxSize?: number;     // Max px on longest output side (default: unlimited)
  outputType?: string;  // MIME type for output (default: 'image/jpeg')
  quality?: number;     // 0–1 compression quality (default: 0.9)
  onCrop: (file: File) => void;
  onCancel: () => void;
}
```

Internal state:
- `rotation` — continuous degrees, range −180 to 180 (driven by a slider)
- `snap` — the coarse 90° increment applied on top (0 / 90 / 180 / 270), toggled by the ↻ button
- `zoom`, `panX`, `panY` — image transform
- `minZoom` — recomputed whenever `rotation + snap` changes; enforces the fill constraint

### New: `ImageCrop.types.ts`
Type exports for the above.

### Modify: `EditableImage.solid.tsx`

Add a `step` signal: `'upload' | 'crop'`.

Current modal flow:
1. File selected → preview shown inline → Save button

New modal flow:
1. **Step: upload** — `we-file-upload` shown. On file selected, auto-advance to `'crop'`. No action buttons needed (selecting a file is the action).
2. **Step: crop** — `ImageCrop` fills the modal. Three buttons:
   - **"Change photo"** (ghost) → resets to `'upload'`, clears `pendingFile`
   - **"Cancel"** (ghost) → closes modal entirely, discards everything
   - **"Save"** → calls `getCroppedFile()`, emits to `onImageChange`, closes

The existing `we-file-upload` + inline preview section is replaced by the two steps.
The `<Show when={preview()}>` block is removed entirely.

Also add `aspect` and `maxSize` props on `EditableImageProps` that pass through to `ImageCrop`.

### Modify: `EditableImage.types.ts`

Add:
```ts
aspect?: number;   // Crop aspect ratio (default: 1 — square). Pass e.g. 16/9 for widescreen.
maxSize?: number;  // Max px on the longest output side. Default: unlimited.
```

---

## Modal UX layout changes

Current:  Title → file-upload → preview image → actions row  
New:
- **Upload step:** Title → `we-file-upload` — no action buttons (selecting a file auto-advances)
- **Crop step:** "Crop Image" title → `ImageCrop` canvas → rotation slider + ↻ snap button below canvas → actions row ("Change photo" / "Cancel" / "Save")

Note: no `we-file-upload` prop changes are needed. Since auto-advance immediately unmounts the upload step via `<Show>`, the internal file-list chip inside the shadow DOM never has a visible moment to appear.

---

## Canvas crop implementation sketch

```
┌──────────────────────────────────┐
│  dim overlay                     │
│    ┌────────────────────┐        │
│    │  crop box          │ drag   │
│    │  (aspect-locked    │ ◄─────►│
│    │   if aspect set)   │        │
│    └────────────────────┘        │
│                     scroll=zoom  │
└──────────────────────────────────┘
```

Interaction model:
- Drag inside crop box → move crop box
- Drag outside crop box → move/pan image
- Scroll wheel / pinch → zoom image
- Crop box always stays within image bounds
- **↻ button** in toolbar → increments `snap` by 90°, resets pan/zoom to fit
- **Rotation slider** (−45° to +45°) → sets `rotation` for fine straightening
- On any rotation/zoom change: `minZoom` is recalculated and `zoom` is clamped to it so the image always fully covers the crop box

**Fill constraint:** For a crop box of size $W \times H$ and total rotation angle $\theta$, the minimum scale needed to ensure no corners are exposed is:
$$\text{minZoom} = \frac{W \cdot |\cos\theta| + H \cdot |\sin\theta|}{W} \;\text{ and }\; \frac{W \cdot |\sin\theta| + H \cdot |\cos\theta|}{H}$$
taking the max of both. Zoom is clamped to this on every frame.

On `getCroppedFile()`:
1. Total angle = `snap + rotation`
2. Create an oversized offscreen canvas, translate to center, apply `ctx.rotate(totalAngle)`, draw the full image
3. Sample the crop rect region from that rotated canvas at image-pixel coordinates
4. If `maxSize` set, scale output dimensions down proportionally so longest side ≤ `maxSize`
5. Draw sampled region into a final output canvas at the target size
6. `outputCanvas.toBlob(resolve, outputType, quality)`
7. Wrap blob as `new File([blob], originalName, { type: outputType })`

---

## Resolved decisions

| Question | Decision |
|---|---|
| Default aspect ratio | `1` (square). Consumer can pass `aspect={16/9}` etc. Pass `aspect={0}` for free-form. |
| Output size cap | `maxSize` prop, default unlimited |
| Back button | No "Back". Use "Change photo" (resets to upload) + "Cancel" (closes modal) |
| `we-file-upload` file list | No changes needed — auto-advance unmounts the element before list renders |

---

## What this does NOT include (future scope)

- Aspect ratio preset picker UI (the `aspect` prop covers the programmatic case; a UI toggle can be added later)
- Upload progress state on `EditableImage` (separate concern)

---

*All open questions resolved — ready to implement.*
