import type { RecordInstance } from '@we/backend-shared';
import type { FileData } from '@we/entities';
import { asFileField, dataURIToFileData, getFileStore, runEntityTransaction } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';

import type { CollectionContentBlock, ContentBlock, ContentDocument, TextContentBlock } from './content';
import {
  isCollectionBlock,
  isContentBlockArray,
  isContentDocument,
  isTextBlock,
  toPortableText,
  walkBlocks,
} from './content';
import { mentionedDids, parseMarks, serializeMarks } from './marks';
import type { CollectionMode } from './modes';
import { isReconcilable } from './modes';
import { getBlockRegistration, getRegisteredBlockEntities } from './registry';
import { encodeBase64Utf8 } from './utils';

/**
 * The dataset a block tree persists into — whatever handle the connected backend takes. This
 * module speaks only the neutral model contract: metadata that used to come from decorator
 * introspection comes from the manifest, transactions and file storage from the runners the
 * backend registered, and the model calls from the entity proxies. Nothing here names a backend.
 */
type BlockDataset = unknown;

/** A block instance as this module handles it: the contract base plus whatever fields its type declares. */
type BlockRecord = RecordInstance & Record<string, unknown>;

/** What a save may hand over — see {@link normalizeInput}. */
export type ContentInput = ContentBlock[] | ContentDocument;

/** The manifest's answer to "which of this entity's fields hold file-stored content". */
function fileFieldNames(entity: string | undefined): string[] {
  if (!entity) return [];
  const properties = CORE_MANIFEST.entities[entity]?.properties ?? {};
  return Object.keys(properties).filter((name) => properties[name].format === 'file');
}

/** The manifest's answer to "which fields does this entity declare at all". */
function propertyNames(entity: string): string[] {
  return Object.keys(CORE_MANIFEST.entities[entity]?.properties ?? {});
}

/** The registry key a text block persists through. */
const TEXT_TYPE = 'block';

/**
 * How deep a walk of the `children` relation will go.
 *
 * `children` is a multi-writer link set in a shared perspective: no writer reads the current set
 * before appending, which is what makes concurrent additions safe, and is also why nothing can stop
 * two agents between them producing a cycle. Neither of them did anything wrong; the graph is
 * simply not guaranteed to be a tree, and code that assumed it was recursed forever. Deleting a
 * collection that had one was impossible — the delete ran inside a transaction and never returned,
 * so the collection could not be removed by any means the app offered.
 *
 * A visited set is the real fix and both walkers now carry one. The depth cap is the belt: a
 * degenerate but acyclic tree — a thousand nested collections, which nothing legitimate produces —
 * would otherwise still exhaust the stack. Well past any real composition; a hand-built document
 * nests single figures.
 */
const MAX_BLOCK_DEPTH = 64;

/** Fields on a content block that are the composition's, not the model's. */
const CONTENT_OWN = new Set(['_type', '_key', 'content', 'children', 'markDefs', '__assetNames']);

// ── Text block ⇄ record ──────────────────────────────────────────────────────

/**
 * A text block as `TextBlock` fields. The record speaks Portable Text's vocabulary — `style`,
 * `listItem`, `level` — with `align`/`direction` as WE extensions, so the stored form and the
 * interchange form say the same thing in the same words. `marks` is written only when there are
 * any: a block without them stores no link, and reads back as one unmarked span.
 */
export function textBlockToRecord(block: TextContentBlock): Record<string, unknown> {
  return {
    style: block.style ?? 'normal',
    listItem: block.listItem ?? '',
    level: block.level ?? 0,
    checked: !!block.checked,
    align: block.align ?? '',
    direction: block.direction ?? '',
    text: block.text ?? '',
    marks: serializeMarks(block.marks),
    version: 1,
  };
}

/**
 * The inverse of {@link textBlockToRecord}. Tolerant by construction: a record with only `text`
 * — a transcript turn, a note — is a paragraph, which is what every field's absence means.
 */
export function recordToTextBlock(record: Record<string, unknown>): TextContentBlock {
  const block: TextContentBlock = { _type: 'block', text: typeof record.text === 'string' ? record.text : '' };
  if (typeof record.id === 'string' && record.id) block._key = record.id;
  const style = String(record.style ?? '');
  block.style = style === 'h1' || style === 'h2' || style === 'h3' || style === 'blockquote' ? style : 'normal';
  const listItem = String(record.listItem ?? '');
  if (listItem === 'bullet' || listItem === 'number' || listItem === 'check') block.listItem = listItem;
  const level = typeof record.level === 'number' ? record.level : Number(record.level ?? 0);
  if (level > 0) block.level = level;
  if (record.checked === true) block.checked = true;
  if (typeof record.align === 'string' && record.align && record.align !== 'left') block.align = record.align;
  if (record.direction === 'rtl') block.direction = 'rtl';
  const marks = parseMarks(record.marks);
  if (marks.length) block.marks = marks;
  return block;
}

// ── Custom block ⇄ record ────────────────────────────────────────────────────

/**
 * Extract property values from a content block for a given model entity.
 * Only includes properties that exist on both the block and the model.
 */
export function extractBlockData(entity: string, block: ContentBlock): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const source: Record<string, unknown> = isTextBlock(block) ? textBlockToRecord(block) : block;
  for (const propName of propertyNames(entity)) {
    if (CONTENT_OWN.has(propName)) continue;
    if (propName in source && source[propName] !== undefined) data[propName] = source[propName];
  }
  return data;
}

/**
 * The fields a block writes to its **model** — {@link extractBlockData}, with every file-format
 * property as the file's data rather than an address.
 *
 * The model layer runs a file property's value through the file-storage language on every write
 * (`createExpression`), and that language wants `{ data_base64, name, file_type }`; hand it an
 * address string and it fails inside the language. So the models get the payload — a `FileData`
 * object as the input component produced it, or the data URI a loaded block carries turned back
 * into one (with the original upload name, so content addressing lands on the same expression) —
 * and only the blob, which is a projection and never written back through a language, carries
 * the addresses `preUploadFileAssets` resolves them to. Uploading the same bytes twice returns the
 * same address, so the double write costs nothing but the round trip.
 */
function modelData(entity: string, block: ContentBlock): Record<string, unknown> {
  const data = extractBlockData(entity, block);
  const fields = block as unknown as Record<string, unknown>;
  const assetNames = fields.__assetNames as Record<string, string> | undefined;
  for (const prop of fileFieldNames(entity)) {
    const value = data[prop];
    if (typeof value === 'string' && value.startsWith('data:')) {
      data[prop] = dataURIToFileData(value, assetNames?.[prop] ?? prop);
    }
  }
  return data;
}

/** entity name → the registry node type its blocks carry as `_type`. */
function nodeTypeForEntity(entity: string): string | undefined {
  if (entity === 'TextBlock') return TEXT_TYPE;
  if (entity === 'CollectionBlock') return 'collection';
  for (const reg of getRegisteredBlockEntities()) {
    if (reg.entity === entity) return reg.nodeTypes.find((t) => t !== 'root') ?? reg.nodeTypes[0];
  }
  return undefined;
}

/** A persisted record as a content block, without its children. */
function recordToBlock(record: BlockRecord, entity: string): ContentBlock {
  if (entity === 'TextBlock') return recordToTextBlock(record);
  const nodeType = nodeTypeForEntity(entity) ?? entity;
  const block: ContentBlock = { _type: nodeType, _key: record.id };
  for (const propName of propertyNames(entity)) {
    if (CONTENT_OWN.has(propName) || propName === 'editorState' || propName === 'textContent') continue;
    const value = record[propName];
    if (value === undefined || value === null || value === '') continue;
    block[propName] = value;
  }
  if (entity === 'CollectionBlock') (block as CollectionContentBlock).content = [];
  return block;
}

// ── Derived projections ──────────────────────────────────────────────────────

/** Text properties to extract per block type for the textContent search index. */
const TEXT_FIELDS_BY_TYPE: Record<string, string[]> = {
  link: ['title', 'description'],
  code: ['title'],
  task: ['title', 'description'],
  callout: ['text'],
  audio: ['title'],
  video: ['title'],
  file: ['title', 'name'],
  event: ['title', 'description', 'location'],
  location: ['name', 'address'],
  tag: ['name'],
  image: ['altText'],
};

const TEXT_CONTENT_MAX_CHARS = 5000;

/**
 * Concatenate all human-readable text in a composition into a single normalised string suitable
 * for full-text search indexing. Whitespace is collapsed to single spaces and the result is capped
 * at TEXT_CONTENT_MAX_CHARS, truncated at the nearest word boundary.
 */
export function extractTextContent(blocks: readonly ContentBlock[]): string {
  const parts: string[] = [];
  walkBlocks(blocks, (block) => {
    if (isTextBlock(block)) {
      const text = (block.text ?? '').trim();
      if (text) parts.push(text);
      return;
    }
    for (const field of TEXT_FIELDS_BY_TYPE[block._type] ?? []) {
      const value = block[field];
      if (typeof value === 'string' && value.trim()) parts.push(value.trim());
    }
  });

  const normalised = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (normalised.length <= TEXT_CONTENT_MAX_CHARS) return normalised;

  const truncated = normalised.slice(0, TEXT_CONTENT_MAX_CHARS);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
}

/**
 * Every DID mentioned anywhere in a composition, de-duplicated, in document order.
 *
 * Read off the `mention` marks rather than parsed out of text, which is the whole point of the
 * edge: handles are mutable and not unique, so a text scan matches the wrong agent whenever two
 * people share a display name and misses one who has since renamed. The editor knows exactly who
 * was picked from the typeahead; the mark preserves that.
 *
 * De-duplicated because the relation is a set — mentioning someone three times in a post is one
 * fact about that post — and ordered because a set built from document order at least reads
 * predictably when displayed.
 */
export function extractMentions(blocks: readonly ContentBlock[]): string[] {
  const dids: string[] = [];
  walkBlocks(blocks, (block) => {
    if (!isTextBlock(block)) return;
    for (const did of mentionedDids(block.marks)) if (!dids.includes(did)) dids.push(did);
  });
  return dids;
}

/** The blob a root carries: the Portable Text projection, encoded as a stored file. */
export function encodeEditorState(blocks: readonly ContentBlock[]): {
  data_base64: string;
  name: string;
  file_type: string;
} {
  return {
    data_base64: encodeBase64Utf8(JSON.stringify(toPortableText(blocks))),
    name: 'editor-state.json',
    file_type: 'application/json',
  };
}

// ── Model helpers ────────────────────────────────────────────────────────────

/** Block model instance that has a children to-many relation */
interface BlockWithChildren extends RecordInstance {
  children: string[];
  // Promise<unknown>, matching the neutral accessor contract — a caller of addChildren gets a
  // completion signal, not a value.
  addChildren: (id: string, batch?: string) => Promise<unknown>;
}

function hasChildrenRelation(block: RecordInstance): block is BlockWithChildren {
  return 'addChildren' in block && typeof (block as BlockWithChildren).addChildren === 'function';
}

function hasChildren(block: RecordInstance): block is BlockWithChildren {
  return Array.isArray((block as BlockWithChildren).children);
}

/** Returns true if a value looks like a FileData object (data_base64 + file_type). */
function isFileData(value: unknown): value is FileData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data_base64' in value &&
    'file_type' in value &&
    typeof (value as FileData).data_base64 === 'string'
  );
}

/**
 * Whatever a save handed over, as blocks plus the base keys of an edit.
 *
 * The caller's own block objects are returned, not copies: persisting stamps `_key` onto them, and
 * a composer that holds the document reconciles against those keys next time.
 */
function normalizeInput(input: ContentInput): { blocks: ContentBlock[]; base?: string[] } {
  if (isContentDocument(input)) return { blocks: input.blocks, base: input.base };
  if (isContentBlockArray(input)) return { blocks: input };
  throw new Error('createBlocks: the content is not a composition (expected blocks or a document)');
}

// ── File assets ──────────────────────────────────────────────────────────────

/**
 * Upload any `FileData` values (or data: URIs round-tripped from {@link resolveExpressionAddresses}
 * — see `dataURIToFileData` in @we/entities) on file-format properties to file storage, and return a
 * patched copy where those values are replaced with the resulting expression addresses (e.g.
 * "QmLang://QmHash"). This keeps the blob small (CIDs instead of raw base64 payloads) and ensures a
 * model's create() path receives a string it can store directly rather than a FileData object.
 *
 * For an unchanged asset round-tripped through resolveExpressionAddresses, `__assetNames` (stamped
 * there) carries the *original* upload name forward — required because file storage is
 * content-addressed on name + size + file_type + data_base64, so re-uploading identical bytes under
 * a different name would produce a different address than the original, orphaning the old one for
 * no reason.
 */
async function preUploadFileAssets(perspective: BlockDataset, blocks: ContentBlock[]): Promise<ContentBlock[]> {
  const fileStore = getFileStore();
  const out: ContentBlock[] = [];
  for (const block of blocks) {
    const patched: ContentBlock = { ...block };
    const fields = patched as unknown as Record<string, unknown>;
    const assetNames = fields.__assetNames as Record<string, string> | undefined;
    delete fields.__assetNames;
    const registration = getBlockRegistration(block._type);
    if (registration && fileStore && !isTextBlock(block)) {
      for (const propName of fileFieldNames(registration.entity)) {
        const value = fields[propName];
        const fileData = isFileData(value)
          ? value
          : typeof value === 'string' && value.startsWith('data:')
            ? dataURIToFileData(value, assetNames?.[propName] ?? propName)
            : undefined;
        if (fileData) fields[propName] = await fileStore.store(perspective, fileData);
      }
    }
    if (isCollectionBlock(patched)) {
      (patched as CollectionContentBlock).content = await preUploadFileAssets(perspective, patched.content ?? []);
    }
    out.push(patched);
  }
  return out;
}

/**
 * Resolve any expression-address strings on file-format properties to data URIs via the dataset.
 * The read-side counterpart to preUploadFileAssets — called before rendering or editing so stored
 * CIDs (e.g. "QmLang://QmHash") are replaced with renderable data URIs.
 */
export async function resolveExpressionAddresses(
  perspective: BlockDataset,
  blocks: readonly ContentBlock[],
): Promise<ContentBlock[]> {
  const fileStore = getFileStore();
  const out: ContentBlock[] = [];
  for (const block of blocks) {
    const patched: ContentBlock = { ...block };
    const fields = patched as unknown as Record<string, unknown>;
    const registration = getBlockRegistration(block._type);
    if (registration && fileStore && !isTextBlock(block)) {
      for (const propName of fileFieldNames(registration.entity)) {
        const val = fields[propName];
        // Only attempt resolution for values holding an address — the "://" is its hallmark, and it
        // is also what skips inline data URIs from a backend that stores nothing out-of-band.
        if (typeof val === 'string' && val.includes('://')) {
          try {
            const data = await fileStore.fetch(perspective, val);
            if (data) {
              fields[propName] = `data:${data.file_type};base64,${data.data_base64}`;
              // Carry the original upload name forward — preUploadFileAssets needs it to reuse this
              // exact address if the asset goes unchanged through an edit round trip.
              if (typeof data.name === 'string') {
                fields.__assetNames = {
                  ...(fields.__assetNames as Record<string, string> | undefined),
                  [propName]: data.name,
                };
              }
            }
          } catch {
            // Leave original value if resolution fails (e.g. offline / bad address)
          }
        }
      }
    }
    if (isCollectionBlock(patched)) {
      (patched as CollectionContentBlock).content = await resolveExpressionAddresses(
        perspective,
        patched.content ?? [],
      );
    }
    out.push(patched);
  }
  return out;
}

// ── Mentions ─────────────────────────────────────────────────────────────────

/** A model exposing `WeNode`'s mentions relation — every block root does, but the type is erased. */
interface NodeWithMentions {
  mentions: string[];
  addMentions(target: string | string[], batch?: string): Promise<void>;
  removeMentions(target: string | string[], batch?: string): Promise<void>;
}

function hasMentions(model: unknown): model is RecordInstance & NodeWithMentions {
  return typeof (model as NodeWithMentions)?.addMentions === 'function';
}

/**
 * Reconcile a root's `we://mention` edges against the mentions in its composition.
 *
 * A read-modify-write, which every other relation on `WeNode` avoids — and correct here for the
 * reason the field's docstring gives: the author owns the text, so they own every mention in it,
 * and there is no second writer to race. Contrast `participants`, where each agent appends only
 * itself precisely because a rewrite would drop whoever lost.
 *
 * Diffed rather than cleared-and-rewritten so that editing a post's wording does not churn links
 * for the mentions it kept — each removed link is a network write, and an unchanged edge should
 * cost nothing.
 */
async function writeMentions(root: RecordInstance, blocks: readonly ContentBlock[], batchId?: string): Promise<void> {
  if (!hasMentions(root)) return;

  const wanted = extractMentions(blocks);
  const current = Array.isArray(root.mentions) ? root.mentions : [];
  if (!wanted.length && !current.length) return;

  const added = wanted.filter((did) => !current.includes(did));
  const removed = current.filter((did) => !wanted.includes(did));

  if (added.length) await root.addMentions(added, batchId);
  if (removed.length) await root.removeMentions(removed, batchId);
}

// ── Create ───────────────────────────────────────────────────────────────────

/**
 * Where a newly-created composition attaches, as a raw predicate link.
 *
 * A predicate rather than a relation name because the two anchors that matter mean different
 * things and live on different models: `we://children` puts a message *inside* a channel
 * (composition — what a container is made of), `we://comment` hangs a reply *off* any `WeNode`
 * (discourse — what was said about it). A relation-name API would have to resolve the name against
 * the anchor's class, which the block system does not have and should not need: it is persisting a
 * document, and where that document belongs is the caller's knowledge.
 */
export interface BlockAnchor {
  /** Id of the existing node the new root links from. */
  id: string;
  /** The predicate to link through — `'we://children'`, `'we://comment'`. */
  predicate: string;
}

export interface CreateBlocksOptions {
  /** Free label stamped onto the root saying what it is for — see the discussion below. */
  kind?: string;
  /**
   * Who owns the root's children (`'document'` | `'feed'` | `'collaborative'`).
   *
   * Defaults to `'document'` **when a `kind` is given**, because everything this function creates
   * is a composed artifact: it persists an editor's document, which is the definition of document
   * mode. A feed container is not made here — it is made with `record.create` and named by its
   * template — so the default is right for every caller of this function and wrong for none.
   *
   * Left unset when no `kind` is given, so a caller that opts out of the whole vocabulary writes
   * neither field and reads back as legacy.
   */
  mode?: CollectionMode;
  /** Attach the root to something that already exists. See {@link BlockAnchor}. */
  anchor?: BlockAnchor;
  /**
   * An open write group to join, instead of opening one.
   *
   * For a caller whose act is larger than composing a document — creating a card *and* recording
   * where it sits on a board. Without it the two commit separately and anything watching the data
   * layer catches the state between them, which on a board looked like the card appearing
   * unpositioned and then moving.
   */
  batchId?: string;
}

/**
 * Create the block models for a composition, in one write group via runEntityTransaction — if any
 * block creation or linking fails, commitBatch() is never called.
 *
 * Parent-child relationships are established via the `children` relation on the root and on any
 * nested collection.
 *
 * `kind` stamps the semantic type onto the root — `'post'` for a post. Optional and supplied by the
 * caller rather than assumed here, because not every root composition is a post: the block system
 * knows how to persist a document, not what the document is for.
 *
 * Why it exists at all: `type: 'root'` has been doing double duty as *the* post discriminator,
 * which conflates the editor's node type with what the collection means. Writing `kind` on new
 * roots starts the changeover without a backfill — reads still key on `type: 'root'`, and can
 * switch once the legacy set stops mattering. There is no coordinated migration point in a P2P
 * system, so a bulk rewrite is not available; converging one record at a time as they are created
 * is.
 *
 * Mutates the blocks handed in: every persisted block gets its `_key` stamped, so a caller holding
 * the document can reconcile against it later.
 */
export async function createBlocks(
  perspective: BlockDataset,
  input: ContentInput,
  options: CreateBlocksOptions = {},
): Promise<BlockRecord | undefined> {
  const { kind, mode = kind ? 'document' : undefined, anchor, batchId } = options;
  const { blocks } = normalizeInput(input);
  const registration = getBlockRegistration('root') ?? getBlockRegistration('collection');
  if (!registration) throw new Error('createBlocks: no collection model is registered');

  return runEntityTransaction(
    perspective,
    async (tx) => {
      // The file store wants addresses, not payloads; upload before anything is written so the
      // records and the blob agree about every asset.
      const uploaded = await preUploadFileAssets(perspective, blocks);
      // `type: 'root'` is what identifies a post to every reader that predates `kind`.
      const rootData: Record<string, unknown> = { type: 'root' };
      const root = (await registration.model.create(perspective, rootData, {
        batchId: tx.batchId,
        ...(anchor && { parent: { id: anchor.id, predicate: anchor.predicate } }),
      })) as BlockRecord;

      // Models are written from the author's blocks (file payloads), the blob from the uploaded
      // copies (file addresses); the two walk in lockstep so every key lands on both.
      for (let i = 0; i < blocks.length; i++) await persistBlock(perspective, tx.batchId, blocks[i], uploaded[i], root);

      // Assigned before the blob write below so both land in that one `save`, rather than costing a
      // second round trip for one string.
      if (kind && 'kind' in root) root.kind = kind;
      if (mode && 'mode' in root) root.mode = mode;

      if ('editorState' in root) {
        root.editorState = asFileField(encodeEditorState(uploaded));
        root.textContent = extractTextContent(uploaded);
      }
      await root.save(tx.batchId);

      // After the save: `addMentions` writes links, which is a separate operation from the property
      // write above and has nothing to add to that round trip.
      await writeMentions(root, uploaded, tx.batchId);
      return root;
    },
    { batchId },
  );
}

/**
 * Create one block's model (and, for a collection, its descendants), link it to its parent, and
 * stamp its id onto the block — both the author's copy and the uploaded one, which share a shape.
 */
async function persistBlock(
  perspective: BlockDataset,
  batchId: string | undefined,
  block: ContentBlock,
  uploaded: ContentBlock | undefined,
  parent: RecordInstance,
): Promise<BlockRecord | undefined> {
  const registration = getBlockRegistration(isTextBlock(block) ? TEXT_TYPE : block._type);
  if (!registration) return undefined;

  const data = modelData(registration.entity, block);
  const model = (await registration.model.create(perspective, data, { batchId })) as BlockRecord;
  block._key = model.id;
  if (uploaded) uploaded._key = model.id;
  if (hasChildrenRelation(parent)) await parent.addChildren(model.id, batchId);

  if (isCollectionBlock(block)) {
    const children = block.content ?? [];
    const uploadedChildren = uploaded && isCollectionBlock(uploaded) ? (uploaded.content ?? []) : [];
    for (let i = 0; i < children.length; i++) {
      await persistBlock(perspective, batchId, children[i], uploadedChildren[i], model);
    }
  }
  return model;
}

// ── Load ─────────────────────────────────────────────────────────────────────

/**
 * Resolve an arbitrary block id to a hydrated instance of its concrete type, and the entity it is.
 *
 * Class-scoped `findOne` per registered block model: a find by id under class X answers null when
 * the record is not an X — every block carries a discriminating flag, and the backend's query
 * machinery filters on it — so the first non-null answer is both the classification and the
 * instance, in one call.
 */
async function resolveBlockInstance(
  perspective: BlockDataset,
  uri: string,
): Promise<{ model: BlockRecord; entity: string } | undefined> {
  for (const registration of getRegisteredBlockEntities()) {
    const block = await registration.model.findOne(perspective, { where: { id: uri } });
    if (block) return { model: block as BlockRecord, entity: registration.entity };
  }
  return undefined;
}

/**
 * Reconstruct a composition from its models: the root's `children`, recursively, as content blocks.
 *
 * The read path the blob is a cache *of* — used when a root has no blob (a call, a notes
 * collection), when its blob is behind its models, or when a caller already holds the root.
 */
export async function loadBlocks(perspective: BlockDataset, rootUri: string): Promise<ContentBlock[] | undefined> {
  const resolved = await resolveBlockInstance(perspective, rootUri);
  if (!resolved) return undefined;
  return childrenToBlocks(perspective, resolved.model);
}

/** The blocks of a hydrated collection's children, recursing into nested collections. */
export async function childrenToBlocks(perspective: BlockDataset, collection: RecordInstance): Promise<ContentBlock[]> {
  if (!hasChildren(collection)) return [];
  const blocks: ContentBlock[] = [];
  for (const childUri of collection.children) {
    const resolved = await resolveBlockInstance(perspective, childUri);
    if (!resolved) continue;
    const block = recordToBlock(resolved.model, resolved.entity);
    if (isCollectionBlock(block)) block.content = await childrenToBlocks(perspective, resolved.model);
    blocks.push(block);
  }
  return blocks;
}

// ── Delete ───────────────────────────────────────────────────────────────────

/**
 * Recursively delete a block tree rooted at rootUri.
 *
 * Resolves each node's model class, hydrates it, deletes descendants before their parent so each
 * `delete()` call only ever has to clean up links to blocks that still exist. Runs inside a
 * transaction so a failure partway through doesn't leave the tree half-deleted.
 */
export async function deleteBlocks(perspective: BlockDataset, rootUri: string): Promise<void> {
  await runEntityTransaction(perspective, async (tx) => {
    const seen = new Set<string>();
    async function deleteNode(uri: string, depth: number): Promise<void> {
      // See `MAX_BLOCK_DEPTH`: `children` is a multi-writer link set, so a cycle in it is something
      // two agents can produce without either doing anything wrong.
      if (seen.has(uri) || depth > MAX_BLOCK_DEPTH) return;
      seen.add(uri);
      const resolved = await resolveBlockInstance(perspective, uri);
      if (!resolved) return;
      if (hasChildren(resolved.model)) {
        for (const childUri of resolved.model.children) await deleteNode(childUri, depth + 1);
      }
      await resolved.model.delete(tx.batchId);
    }
    await deleteNode(rootUri, 0);
  });
}

// ── Reconcile ────────────────────────────────────────────────────────────────

type Resolved = { model: BlockRecord; entity: string };

/**
 * Hydrates every descendant of `childUris` (recursively), keyed by id. Shared by `reconcileBlocks`
 * for matching (does this id still exist?), for cleanup (delete what the author dropped), and for
 * keeping what the author never saw (another agent's additions) without resolving each instance's
 * model class twice.
 */
async function collectDescendants(perspective: BlockDataset, childUris: string[]): Promise<Map<string, Resolved>> {
  const result = new Map<string, Resolved>();
  async function walk(uri: string, depth: number): Promise<void> {
    // `result` doubles as the visited set — a block reachable by two paths is the same block, and
    // resolving it twice would be wasted work even without the cycle. See `MAX_BLOCK_DEPTH`.
    if (result.has(uri) || depth > MAX_BLOCK_DEPTH) return;
    const resolved = await resolveBlockInstance(perspective, uri);
    if (!resolved) return;
    result.set(uri, resolved);
    if (hasChildren(resolved.model)) for (const childUri of resolved.model.children) await walk(childUri, depth + 1);
  }
  for (const uri of childUris) await walk(uri, 0);
  return result;
}

/**
 * Reconcile an existing composition against a freshly-edited one, instead of deleting and
 * recreating everything.
 *
 * Every block that existed carries its `_key`. A block whose key matches an existing descendant —
 * and has not already been claimed earlier in this same save (a copy/pasted duplicate) — is updated
 * in place; anything else is created. Each parent's `children` relation is assigned the final
 * ordered id list once its subtree is reconciled — relation assignment fully replaces the link set,
 * so reordering and reparenting fall out for free without needing a separate move/diff step.
 *
 * ## Three-way membership
 *
 * Removals are computed against **what the author loaded**, not against the current state. The
 * document carries `base` — the keys of every block it started from — and a block is deleted only
 * if it was in the base and is absent now. A block that is present in the store but not in the base
 * is somebody else's addition made while the author was editing: it is kept, and re-linked after
 * the author's blocks so it survives the relation assignment. Without this the orphan pass would
 * delete other people's content the moment two agents edited near each other, which under
 * concurrent editing is the common case rather than the edge one.
 *
 * A save with no `base` (a legacy caller) falls back to treating everything existing as loaded,
 * which is the old behaviour exactly.
 *
 * ## Document-mode only
 *
 * Every sentence above assumes the incoming document is the **whole truth** about this collection's
 * authored content — which is true of an artifact one agent authored and just re-saved, and false
 * of a container many agents append to. Run this against a channel and the removal pass deletes
 * every message the editing agent's document does not mention, which is all of them but their own.
 *
 * So it refuses anything whose `mode` is registered as a non-document mode (see `modes.ts`; the
 * check is an allow-list, and legacy `kind`-less posts pass). Loud, because the alternative failure
 * is silent and destroys other people's content.
 */
export async function reconcileBlocks(
  perspective: BlockDataset,
  existingRoot: BlockWithChildren,
  input: ContentInput,
): Promise<RecordInstance> {
  // Read structurally rather than through `CollectionBlock`: the parameter is typed as a generic
  // block root, and `Partial<CollectionBlock>` does not overlap it enough for a direct cast.
  const root = existingRoot as BlockWithChildren & { kind?: string; mode?: string };
  if (!isReconcilable(root.mode)) {
    throw new Error(
      `reconcileBlocks refused: collection '${root.kind || 'untitled'}' is in '${root.mode}' mode, not 'document'. ` +
        'Reconciling it would delete every child the incoming document omits, which in a container ' +
        "many agents write to is everyone else's content. Append with createBlocks({ anchor }) instead.",
    );
  }

  const { blocks: authored, base: baseKeys } = normalizeInput(input);

  return runEntityTransaction(perspective, async (tx) => {
    const existing = await collectDescendants(perspective, existingRoot.children);
    const base = new Set(baseKeys ?? [...existing.keys()]);
    const claimed = new Set<string>();
    const uploaded = await preUploadFileAssets(perspective, authored);

    /** The blob's view of a parent's final children: the author's blocks, then anything kept. */
    const finalBlocks = new Map<RecordInstance, ContentBlock[]>();

    async function reconcileList(
      blocks: ContentBlock[],
      uploadedBlocks: ContentBlock[],
      parent: BlockWithChildren,
    ): Promise<void> {
      const orderedIds: string[] = [];
      for (let i = 0; i < blocks.length; i++) {
        const model = await reconcileOne(blocks[i], uploadedBlocks[i]);
        if (model) orderedIds.push(model.id);
      }
      // Somebody else's additions — present now, absent from what the author loaded — keep their
      // links, after the author's blocks. Their own descendants are never touched: they are not in
      // the base either, so the removal pass below skips them.
      const current = Array.isArray(parent.children) ? parent.children : [];
      const kept = current.filter((id) => !base.has(id) && !claimed.has(id) && !orderedIds.includes(id));
      parent.children = [...orderedIds, ...kept];

      finalBlocks.set(parent, [
        ...uploadedBlocks.filter((b) => typeof b._key === 'string' && orderedIds.includes(b._key)),
        ...(await Promise.all(kept.map((id) => keptBlock(id)))).filter((b): b is ContentBlock => !!b),
      ]);
    }

    async function keptBlock(id: string): Promise<ContentBlock | undefined> {
      const resolved = existing.get(id);
      if (!resolved) return undefined;
      const block = recordToBlock(resolved.model, resolved.entity);
      if (isCollectionBlock(block)) block.content = await childrenToBlocks(perspective, resolved.model);
      return block;
    }

    async function reconcileOne(
      block: ContentBlock,
      uploaded: ContentBlock | undefined,
    ): Promise<BlockRecord | undefined> {
      const registration = getBlockRegistration(isTextBlock(block) ? TEXT_TYPE : block._type);
      /*
        A block type this client does not know: keep it exactly where it is.

        Returning `undefined` here used to be the whole answer, and it was destructive. The id never
        reached `orderedIds`; `kept` only rescues blocks that are *not* in the base, and this one is;
        so the parent's `children` link went, and the removal pass below — which deletes anything in
        the base that nothing claimed — deleted the model too. Editing one paragraph of a post
        silently destroyed every block in it whose type this build had never heard of.

        Claiming it and returning the model it already has puts the link back in the author's order
        and leaves the record untouched. Nothing is written for it: `data` would be built from a
        registration that does not exist, and a block we cannot read is not a block we should write.

        Today all sixteen core types register unconditionally, so this bites only once a module or a
        space shape contributes a block type — which is exactly what `blockableEntities` exists for,
        and exactly the case where "somebody else has a plugin I don't" is normal rather than an
        error. A block with no stored record and no registration is genuinely nothing this client can
        represent, and only that case is dropped.
      */
      if (!registration) {
        const unknownId = typeof block._key === 'string' ? block._key : undefined;
        const stored = unknownId && !claimed.has(unknownId) ? existing.get(unknownId) : undefined;
        if (unknownId && stored) {
          claimed.add(unknownId);
          return stored.model;
        }
        return undefined;
      }

      const data = modelData(registration.entity, block);
      const existingId = typeof block._key === 'string' ? block._key : undefined;
      let model: BlockRecord | undefined;
      if (existingId && !claimed.has(existingId)) {
        const found = existing.get(existingId);
        if (found) {
          model = found.model;
          claimed.add(existingId);
          // Only what changed. A file field the author never touched reads back as the same data
          // URI it was loaded as, and writing it again would re-upload the file for nothing.
          const raw = block as unknown as Record<string, unknown>;
          for (const key of Object.keys(data)) if (model[key] === raw[key]) delete data[key];
          Object.assign(model, data);
          await model.save(tx.batchId);
        }
      }
      if (!model) {
        model = (await registration.model.create(perspective, data, { batchId: tx.batchId })) as BlockRecord;
      }
      block._key = model.id;
      if (uploaded) uploaded._key = model.id;

      if (isCollectionBlock(block) && hasChildrenRelation(model)) {
        const uploadedChildren = uploaded && isCollectionBlock(uploaded) ? (uploaded.content ?? []) : [];
        await reconcileList(block.content ?? [], uploadedChildren, model);
        await model.save(tx.batchId);
      }
      return model;
    }

    await reconcileList(authored, uploaded, existingRoot);

    for (const [id, resolved] of existing) {
      if (!claimed.has(id) && base.has(id)) await resolved.model.delete(tx.batchId);
    }

    const blobBlocks = withFinalChildren(uploaded, existingRoot);
    const rootRecord = existingRoot as BlockWithChildren & Record<string, unknown>;
    rootRecord.editorState = asFileField(encodeEditorState(blobBlocks));
    rootRecord.textContent = extractTextContent(blobBlocks);
    await existingRoot.save(tx.batchId);

    // Edits add and remove mentions like any other content, so the edge set is reconciled here for
    // the same reason `textContent` is rewritten: both are projections of the document that just
    // changed.
    await writeMentions(existingRoot, blobBlocks, tx.batchId);
    return existingRoot;

    /** The blocks a parent ends up with, kept additions included, recursively. */
    function withFinalChildren(fallback: ContentBlock[], parent: RecordInstance): ContentBlock[] {
      const list = finalBlocks.get(parent) ?? fallback;
      return list.map((block) => {
        if (!isCollectionBlock(block) || !block._key) return block;
        const model = existing.get(block._key)?.model ?? findCreated(block._key);
        return model ? { ...block, content: withFinalChildren(block.content ?? [], model) } : block;
      });
    }

    function findCreated(id: string): RecordInstance | undefined {
      for (const parent of finalBlocks.keys()) if (parent.id === id) return parent;
      return undefined;
    }
  });
}
