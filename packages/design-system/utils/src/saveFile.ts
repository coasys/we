/**
 * Putting a file on the reader's machine — the one way WE does it, wherever a download is offered.
 *
 * ## Why not just an `<a download>`
 *
 * That was every call site: build a blob, click a hidden link, say "exported". The link *starts* a
 * download and reports nothing back, so the page cannot know whether the reader picked a folder,
 * cancelled the dialog, or where the file went — and the success toast arrived before any of that
 * had happened, including when they went on to cancel.
 *
 * So there are three ways to save, tried in order, and each says what actually happened:
 *
 * 1. **The host's own**, where it lends one (`provideFileSaver`) — the desktop app's native dialog,
 *    written by the main process. Preferred because it answers definitely and needs nothing from
 *    the page's permissions.
 * 2. **The browser's save picker** (`showSaveFilePicker`, Chromium) — a real save dialog whose
 *    promise settles when the file is written, or rejects when the reader cancels.
 * 3. **A plain download**, everywhere else. The browser shows its own download UI, which is the
 *    only confirmation this path can honestly give.
 *
 * ## Content can be a function, and that is not a convenience
 *
 * A browser only opens a file picker while it is still handling the click that asked for it — a
 * few seconds of "user activation". An export that gathers its content first (queries, profile
 * lookups) can outlive that window, and the picker then refuses to open at all. So when the picker
 * is the path, it opens *first* and the content is produced into it afterwards. Every other path
 * produces first, since neither needs the click.
 */

/** What a save came to. Only `saved` is worth a success message. */
export type SaveOutcome =
  /** Written where the reader chose. */
  | 'saved'
  /** The reader closed the dialog. Nothing to say. */
  | 'cancelled'
  /** Handed to the browser as a download, whose own UI confirms it. */
  | 'downloaded'
  /** The content turned out to be nothing, so nothing was written. The caller says why. */
  | 'empty';

export type SaveContent = Blob | string;

export interface SaveFileOptions {
  /** The suggested file name, extension included. */
  name: string;
  /** Its MIME type. Parameters (`;charset=utf-8`) are fine. */
  type: string;
  /**
   * What to write, or a function producing it — `null` from the function meaning there is nothing
   * to export after all. Pass a function whenever producing the content is not instant; see above.
   */
  content: SaveContent | (() => Promise<SaveContent | null> | SaveContent | null);
}

/** A host's own save dialog: resolves true once written, false when the reader cancelled. */
export type HostFileSaver = (file: { name: string; type: string; bytes: Uint8Array }) => Promise<boolean>;

let hostSaver: HostFileSaver | null = null;

/**
 * Lend the host's native save dialog to every download in the app. Returns the way to take it back.
 *
 * Module-level rather than passed down, because the call sites are in three packages — a store, the
 * editor, a block — none of which can see the platform, and all of which share this one.
 */
export function provideFileSaver(saver: HostFileSaver): () => void {
  hostSaver = saver;
  return () => {
    if (hostSaver === saver) hostSaver = null;
  };
}

interface PickerHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  /** Chromium only, and not in every version — used to take back a file that ended up empty. */
  remove?(): Promise<void>;
}

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<PickerHandle>;

const asBlob = (content: SaveContent, type: string): Blob =>
  typeof content === 'string' ? new Blob([content], { type }) : content;

async function produce(options: SaveFileOptions): Promise<Blob | null> {
  const content = typeof options.content === 'function' ? await options.content() : options.content;
  return content === null ? null : asBlob(content, options.type);
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Not synchronously: some browsers read the URL after the click returns, and a revoked one
  // downloads nothing.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * What the picker is told to offer, from the name's extension — or nothing, which leaves the dialog
 * accepting anything rather than refusing a type it was never told about.
 */
function pickerTypes(name: string, type: string) {
  const extension = /\.[A-Za-z0-9]+$/.exec(name)?.[0];
  const mime = type.split(';')[0].trim();
  if (!extension || !/^[\w.+-]+\/[\w.+-]+$/.test(mime)) return undefined;
  return [{ accept: { [mime]: [extension] } }];
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** Save a file the best way this environment has, and say what happened. See the file note. */
export async function saveFile(options: SaveFileOptions): Promise<SaveOutcome> {
  if (hostSaver) {
    const blob = await produce(options);
    if (!blob) return 'empty';
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return (await hostSaver({ name: options.name, type: options.type, bytes })) ? 'saved' : 'cancelled';
  }

  const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    let handle: PickerHandle | null = null;
    try {
      handle = await picker({ suggestedName: options.name, types: pickerTypes(options.name, options.type) });
    } catch (error) {
      if (isAbort(error)) return 'cancelled';
      // Refused rather than cancelled — the click's activation ran out, a frame is not allowed
      // pickers, a policy said no. A download still gets the file to the reader.
    }
    if (handle) {
      const blob = await produce(options);
      if (!blob) {
        await handle.remove?.().catch(() => undefined);
        return 'empty';
      }
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    }
  }

  const blob = await produce(options);
  if (!blob) return 'empty';
  download(options.name, blob);
  return 'downloaded';
}

/** A `data:` URI as the Blob it encodes — for saving a file that is stored inline. */
export function dataUriToBlob(dataUri: string): Blob {
  const commaIndex = dataUri.indexOf(',');
  const header = dataUri.slice(0, commaIndex);
  const body = dataUri.slice(commaIndex + 1);
  const mime = /^data:([^;,]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  if (!/;base64/i.test(header)) return new Blob([decodeURIComponent(body)], { type: mime });
  const binary = atob(body.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
