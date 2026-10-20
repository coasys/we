/**
 * The file a `Template` record's `schema` property holds — the one encoding and the one decoding
 * of it.
 *
 * The property is a file field: written as FileData (base64 JSON), read back as whatever the backend
 * resolves the file to. The JSON is `{ schema }`, and a save of an existing record adds `savedAt`
 * beside it, so two saves of the same schema are two files rather than one a content-addressed
 * store refuses. Records written earlier hold the bare schema, or `{ schema, sections }` with a
 * section index nothing reads any more; both still decode.
 *
 * Kept free of any backend and any DOM, because more than the app reads and writes these files: an
 * agent host editing a template headless has to produce exactly what the app would, or the app
 * stops being able to open it.
 */
import type { FileData } from './imageHelpers';

/** What a template's root is, as far as storage cares: a node. The schema types live with the schema system. */
export interface StoredSchema {
  type: string;
  [key: string]: unknown;
}

export const TEMPLATE_FILE_NAME = 'template-schema.json';

/**
 * A schema as the file its record holds.
 *
 * `savedAt` marks a save of an existing record: it makes the file unique to the moment, which a
 * content-addressed store needs to accept the same schema twice (after an undo, say). A record's
 * first write does without it.
 */
export function encodeTemplateFile(schema: object, options: { savedAt?: number } = {}): FileData {
  const body = options.savedAt === undefined ? { schema } : { schema, savedAt: options.savedAt };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  // UTF-8 first, since btoa takes only Latin-1 and a template is full of em dashes; in chunks,
  // since a large template is hundreds of thousands of bytes.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data_base64: btoa(binary), name: TEMPLATE_FILE_NAME, file_type: 'application/json' };
}

/**
 * The schema in a `Template.schema` value, or undefined when there is none to read.
 *
 * Takes the property however it arrives: resolved to a `data:` URI (how the app reads it), as the
 * FileData it was written with, as the JSON text, or already parsed. Every stored shape comes back
 * as the schema alone. Nothing here judges the schema beyond its being a node — that is the
 * reader's acceptance step — so `T` is the caller's claim, not a check.
 */
export function decodeTemplateFile<T extends object = StoredSchema>(value: unknown): T | undefined {
  const parsed = parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const schema = record.schema && typeof record.schema === 'object' ? record.schema : record;
  return typeof (schema as { type?: unknown }).type === 'string' ? (schema as T) : undefined;
}

function parse(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      const marker = value.indexOf(';base64,');
      return marker < 0 ? undefined : json(fromBase64(value.slice(marker + ';base64,'.length)));
    }
    return json(value);
  }
  if (value && typeof value === 'object' && typeof (value as FileData).data_base64 === 'string') {
    return json(fromBase64((value as FileData).data_base64));
  }
  return value;
}

function fromBase64(base64: string): string | undefined {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return undefined;
  }
}

function json(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
