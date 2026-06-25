import { Column } from '@we/components/solid';
import { createSignal } from 'solid-js';

interface BlockPlaceholderProps {
  /** Icon name passed to we-icon — should match the block type (e.g. "image", "speaker-high"). */
  icon: string;
  /** Primary label, e.g. "Add an image". */
  label: string;
  /** Secondary hint shown below the label.
   * Defaults to "Drop here or click for options" when `onFileDrop` is provided,
   * or "Click to configure" otherwise.
   */
  hint?: string;
  /**
   * Accepted mime types for drag-drop filtering, in HTML `accept` attribute format.
   * e.g. "image/*", "video/*", "audio/*,video/*"
   * If omitted, all file types are accepted.
   */
  accept?: string;
  /** Called when a file is dropped directly onto the placeholder. */
  onFileDrop?: (file: File) => void;
  /** Called when the placeholder is clicked (should open the config modal). */
  onClick?: () => void;
}

/** Returns true if the file matches the accept string (HTML accept attribute format). */
function matchesAccept(file: File, accept: string): boolean {
  return accept.split(',').some((token) => {
    const t = token.trim();
    if (t.startsWith('.')) return file.name.toLowerCase().endsWith(t.toLowerCase());
    if (t.endsWith('/*')) return file.type.startsWith(t.slice(0, -1));
    return file.type === t;
  });
}

/**
 * Consistent empty-state placeholder for media and advanced block types.
 *
 * When `onFileDrop` is provided the border is dashed and the zone accepts file
 * drops (image, audio, video, file blocks). Without it the border is solid and
 * the placeholder is click-only (link, embed, event, task, etc.).
 *
 * Intentionally does NOT wrap `we-file-upload` — that primitive's click-to-browse
 * behaviour conflicts with our click-to-open-modal requirement here. `we-file-upload`
 * belongs inside the config modal for the browse + drop flow there.
 */
export function BlockPlaceholder(props: BlockPlaceholderProps) {
  const [dragOver, setDragOver] = createSignal(false);
  const droppable = () => !!props.onFileDrop;

  function onDragOver(e: DragEvent) {
    if (!droppable() || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    setDragOver(true);
  }

  function onDragLeave(e: DragEvent) {
    // Ignore leave events firing on child elements.
    if ((e.currentTarget as Element).contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!props.onFileDrop || !e.dataTransfer?.files.length) return;
    const file = e.dataTransfer.files[0];
    if (props.accept && !matchesAccept(file, props.accept)) return;
    props.onFileDrop(file);
  }

  const borderStyle = () => {
    if (dragOver()) return '2px dashed var(--we-color-primary-500)';
    if (droppable()) return '2px dashed var(--we-color-neutral-200)';
    return '2px solid var(--we-color-neutral-200)';
  };

  const defaultHint = () => (droppable() ? 'Drop here or click for options' : 'Click to configure');

  return (
    <Column
      ax="center"
      ay="center"
      gap="200"
      p="600"
      r="300"
      border={borderStyle()}
      bg={dragOver() ? 'primary-50' : 'neutral-25'}
      cursor="pointer"
      minHeight="120px"
      transition="border-color 0.15s ease, background 0.15s ease"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={props.onClick}
      data-file-droppable={droppable() ? 'true' : undefined}
    >
      <we-icon name={props.icon} color={dragOver() ? 'primary-500' : 'neutral-400'} size="lg" />
      <we-text color={dragOver() ? 'primary-700' : 'neutral-600'} fontSize="400" fontWeight="500" textAlign="center">
        {props.label}
      </we-text>
      <we-text color={dragOver() ? 'primary-500' : 'neutral-400'} fontSize="300" textAlign="center">
        {props.hint ?? defaultHint()}
      </we-text>
    </Column>
  );
}
