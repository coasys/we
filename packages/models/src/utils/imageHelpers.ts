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

export function resizeImage(file: Blob, percentage: number, maxSize = 80): Promise<Blob> {
  const reader = new FileReader();
  const image = new Image();
  const canvas = document.createElement('canvas');

  const resize = () => {
    let { width, height } = image;

    if (width <= maxSize || height <= maxSize) {
      if (width > height) {
        if (width > maxSize) {
          height *= maxSize / width;
          width = maxSize;
        }
      } else if (height > maxSize) {
        width *= maxSize / height;
        height = maxSize;
      }
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
 * Compress a browser File to a FileData value object suitable for AD4M's
 * FILE_STORAGE_LANGUAGE. The compression percentage (0.6) and output format
 * (image/png) match the convention used across all image uploads in the app.
 */
export async function compressImageToFileData(file: File, name: string): Promise<FileData> {
  const blob = await resizeImage(file, 0.6);
  return { data_base64: await blobToDataURL(blob), name, file_type: 'image/png' };
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
