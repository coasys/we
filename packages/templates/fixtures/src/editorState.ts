/**
 * Plain paragraphs → the editor state a `CollectionBlock` carries.
 *
 * `BlockRenderer` accepts either decoded blocks or the `data:…;base64,…` string that AD4M's
 * file-storage resolution hands back, and decodes the latter itself. Fixtures produce the string,
 * because that is the shape a row actually *reads* as in the running app — an object would work
 * here and diverge from what a real post looks like, which is the one thing a fidelity fixture
 * must not do.
 *
 * The blob is the Portable Text projection `createBlocks` writes: one `block` per paragraph with
 * its canonical `text`, its (empty) `marks`, and the derived `children` span a Portable Text
 * consumer reads. Block keys are the ids of the `TextBlock` models `apply` writes beside the blob,
 * so the two agree the way a real post's do. Hand-built rather than imported from
 * `@we/block-shared`, so this package stays a data package with no block-system dependency.
 */

interface PortableTextBlock {
  _type: 'block';
  _key: string;
  style: 'normal';
  text: string;
  children: Array<{ _type: 'span'; _key: string; text: string; marks: string[] }>;
  markDefs: never[];
}

/** The key the `TextBlock` model for paragraph `index` (0-based) of collection `id` gets. */
export function textBlockId(collectionId: string, index: number): string {
  return `${collectionId}-text-${index + 1}`;
}

const block = (value: string, key: string): PortableTextBlock => ({
  _type: 'block',
  _key: key,
  style: 'normal',
  text: value,
  children: [{ _type: 'span', _key: 's1', text: value, marks: [] }],
  markDefs: [],
});

/** Base64 of the UTF-8 bytes, matching what `createBlocks` writes for a real post. */
function encode(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The blocks, as an array — for a caller that wants to inspect rather than store them. */
export function editorStateBlocks(paragraphs: readonly string[], collectionId = 'fixture'): PortableTextBlock[] {
  return paragraphs.map((value, index) => block(value, textBlockId(collectionId, index)));
}

/** The stored form: a data URL, exactly as a resolved file field reads. */
export function editorState(paragraphs: readonly string[], collectionId = 'fixture'): string {
  return `data:application/json;base64,${encode(JSON.stringify(editorStateBlocks(paragraphs, collectionId)))}`;
}

/** What `CollectionBlock.textContent` holds — the searchable plain text of a post. */
export function textContent(paragraphs: readonly string[]): string {
  return paragraphs.join(' ');
}
