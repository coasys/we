/**
 * Plain paragraphs → the editor state a `CollectionBlock` carries.
 *
 * `BlockRenderer` accepts either a `SerializedBlockNode` object or the `data:…;base64,…` string that
 * AD4M's file-storage resolution hands back, and decodes the latter itself. Fixtures produce the
 * string, because that is the shape a row actually *reads* as in the running app — an object would
 * work here and diverge from what a real post looks like, which is the one thing a fidelity fixture
 * must not do.
 *
 * The node shape is Lexical's, because the renderer hands it straight to `editor.parseEditorState`.
 * `version: 1` is not decoration: editor-produced state always carries it, and Lexical throws
 * without it — which surfaces as a silently empty message body and a console error several frames
 * from the cause.
 */

interface LexicalNode {
  type: string;
  version: number;
  children?: LexicalNode[];
  [key: string]: unknown;
}

const text = (value: string): LexicalNode => ({
  type: 'text',
  version: 1,
  text: value,
  format: 0,
  detail: 0,
  mode: 'normal',
  style: '',
});

const paragraph = (value: string): LexicalNode => ({
  type: 'paragraph',
  version: 1,
  children: [text(value)],
  direction: 'ltr',
  format: '',
  indent: 0,
  textFormat: 0,
});

/** Base64 that survives non-ASCII, matching what `createBlocks` writes for a real post. */
function encode(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The root node, as an object — for a caller that wants to inspect rather than store it. */
export function editorStateNode(paragraphs: readonly string[]): LexicalNode {
  return {
    type: 'root',
    version: 1,
    children: paragraphs.map(paragraph),
    direction: 'ltr',
    format: '',
    indent: 0,
  };
}

/** The stored form: a data URL, exactly as a resolved file field reads. */
export function editorState(paragraphs: readonly string[]): string {
  return `data:application/json;base64,${encode(JSON.stringify(editorStateNode(paragraphs)))}`;
}

/** What `CollectionBlock.textContent` holds — the searchable plain text of a post. */
export function textContent(paragraphs: readonly string[]): string {
  return paragraphs.join('\n');
}
