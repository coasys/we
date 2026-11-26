/**
 * A file's contents as a data URI, as `FileReader.readAsDataURL` gives it — read through the Blob
 * API every JavaScript runtime has, so a store reading a file runs where there is no DOM.
 */
export async function fileAsDataURI(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  // In slices: spreading a whole file into one call overflows the argument limit.
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}
