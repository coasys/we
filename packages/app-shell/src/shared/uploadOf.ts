import type { UploadFile } from '@we/backend-shared';
import type { FileData } from '@we/entities';

/** A compressed or decoded file, as the profile directory's `uploadFile` takes it. */
export function uploadOf(file: FileData): UploadFile {
  return { base64: file.data_base64, mimeType: file.file_type, name: file.name };
}
