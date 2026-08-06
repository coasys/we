export function dataURItoBlob(dataURI: string): Blob {
  const bytes =
    dataURI.split(',')[0].indexOf('base64') >= 0 ? atob(dataURI.split(',')[1]) : unescape(dataURI.split(',')[1]);
  const mime = dataURI.split(',')[0].split(':')[1].split(';')[0];
  const max = bytes.length;
  const ia = new Uint8Array(max);
  for (let i = 0; i < max; i += 1) ia[i] = bytes.charCodeAt(i);
  return new Blob([ia], { type: mime });
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new Error('Read aborted'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Scale a bitmap down, either to a proportion of its size or to a longest-edge ceiling.
 *
 * `maxSize` defaults to no ceiling. It used to default to 80 with an inverted guard — the clamp
 * only ran when the image was *already* under 80px, so every real photo fell through to plain
 * percentage scaling and the ceiling never applied to anything. Correcting the guard without
 * changing that default would have shrunk every image block in every post to 80px, so the default
 * now says what the code actually did.
 */
export function resizeImage(file: Blob, percentage: number, maxSize = Infinity): Promise<Blob> {
  const reader = new FileReader();
  const image = new Image();
  const canvas = document.createElement('canvas');

  const resize = () => {
    let { width, height } = image;

    const longest = Math.max(width, height);
    if (longest > maxSize) {
      // A ceiling was asked for and the image exceeds it: scale the longest edge onto it.
      const scale = maxSize / longest;
      width *= scale;
      height *= scale;
    } else {
      height = height * percentage;
      width = width * percentage;
    }

    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/png');
    return dataURItoBlob(dataUrl);
  };

  return new Promise((ok, no) => {
    if (!file.type.match(/image.*/)) {
      no(new Error('Not an image'));
      return;
    }

    reader.onload = (readerEvent) => {
      image.onload = () => ok(resize());
      image.src = readerEvent.target?.result as string;
    };

    reader.onerror = (err) => {
      image.onerror = () => no(err);
    };

    reader.readAsDataURL(file);
  });
}

export interface FileData {
  data_base64: string;
  name: string;
  file_type: string;
}

/**
 * Write a {@link FileData} blob to a model field that is declared `string`.
 *
 * File-backed fields — `Template.schema`, `Theme.css`, `Theme.overrides`, `ImageBlock.src`
 * — are typed by what you read back: the expression URL the ORM resolves to once
 * FILE_STORAGE_LANGUAGE has stored the content. On write they also accept the blob itself,
 * which the language uploads and replaces with that URL.
 *
 * TypeScript cannot give a single property different read and write types, so the cast
 * lives here — named and explained once — rather than as a bare `as any` at each of the
 * thirty-odd assignment sites, where it read as an absent type rather than a deliberate
 * asymmetry.
 */
export function asFileField(data: FileData): string {
  return data as unknown as string;
}

/**
 * Compress a browser File to a FileData value object suitable for AD4M's
 * FILE_STORAGE_LANGUAGE. The compression percentage (0.6) and output format
 * (image/png) match the convention used across all image uploads in the app.
 */
export async function compressImageToFileData(file: File, name: string, maxSize?: number): Promise<FileData> {
  const blob = await resizeImage(file, 0.6, maxSize);
  return { data_base64: await blobToDataURL(blob), name, file_type: 'image/png' };
}

/**
 * Re-encode an existing image at a longest-edge ceiling.
 *
 * For copies that have to stay small in absolute terms rather than relative to the original — the
 * account registry's cached avatar, which is read from a JSON file at every boot and is capped, so
 * a percentage of an arbitrarily large photo is not a bound at all.
 *
 * Takes a data URI because that is what the caller already has: the picture has been compressed and
 * published by then, and the original File is long gone.
 */
export async function shrinkDataUri(dataUri: string, maxSize: number): Promise<string> {
  const blob = await (await fetch(dataUri)).blob();
  // Percentage 1: already inside the ceiling means leave it alone, not shrink it again.
  const resized = await resizeImage(blob, 1, maxSize);
  return `data:image/png;base64,${await blobToDataURL(resized)}`;
}

/**
 * Read any browser File into a FileData value object suitable for AD4M's
 * FILE_STORAGE_LANGUAGE.  Unlike compressImageToFileData, no resizing or
 * format conversion is applied — the file is stored as-is.
 */
export async function readFileAsFileData(file: File): Promise<FileData> {
  const data_base64 = await blobToDataURL(file);
  return {
    data_base64,
    name: file.name,
    file_type: file.type || 'application/octet-stream',
  };
}

/**
 * Reconstruct a FileData value object from a resolved data URI string.
 *
 * After AgentProfile.findOne() / Space.findOne() the resolveLanguage transform
 * converts stored FileData objects to `data:<mime>;base64,<b64>` strings.
 * This function reverses that transform so the value can be safely passed back
 * through FILE_STORAGE_LANGUAGE — the storage is content-addressed
 * (address = hash(name + size + file_type + data_base64)), so uploading the
 * same bytes again returns the same address with no new file created.
 *
 * The `name` argument must match the name used on the original upload because
 * it is part of the hash input.
 */
export function dataURIToFileData(dataUri: string, name: string): FileData {
  const [header, data_base64] = dataUri.split(',');
  const file_type = header.split(';')[0].split(':')[1];
  return { data_base64, name, file_type };
}
