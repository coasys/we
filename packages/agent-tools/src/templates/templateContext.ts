/**
 * templateContext — how much of the template being edited is sent, and what fetches the rest.
 *
 * The other half of the context budget. `contextStrategies` decides how much of the generated
 * REFERENCE the model is told; this decides how much of the TEMPLATE, which for a real one is the
 * larger number: `workshopTemplate` is 400,460 characters compacted against a reference core of
 * about a third of that.
 *
 * One dial, a character budget, and no threshold anywhere. A template that fits is sent whole —
 * not as a special case for small templates, but because filling a budget with the most relevant
 * thing first and stopping when it is full sends everything when everything fits. So `blank` and
 * `feed` behave exactly as they did, and nothing changes shape at a boundary.
 *
 * ## What this buys, measured rather than predicted
 *
 * 24 runs over four `kanban` cases, whole against bounded, in `eval/BASELINE.md`:
 *
 * - **Accuracy is untouched** — 28 runs, every arm, both templates. A model edits from an outline
 *   plus the parts it was handed exactly as well as from the whole tree. Not obvious beforehand,
 *   and the finding the whole approach needed.
 * - **It saves about half on a large template.** `workshopTemplate`: 183K tokens a case against
 *   354K whole, in two model calls either way.
 * - **And costs a few percent on a small one.** `kanbanTemplate`: 120K against 116K. The saving
 *   is the template minus its outline and grows with the template; the cost is one extra call at
 *   system-prompt price and does not. Kanban sits below that crossover, workshop well above it —
 *   which is what the budget is for.
 * - **Where preselection misses, the extra call can cost more than bounding saves.** That is the
 *   thing to protect: detail sent unasked is what stops the model reaching for `we_template`, so
 *   preselection quality is the lever rather than outline size. Both workshop cases needed no
 *   tool call at all.
 *
 * Above the budget the model gets:
 *
 * - **an outline** — every node's id, type and a clue, nothing else. 12% of the compacted template
 *   on `kanbanTemplate`, 24% on `workshopTemplate`. This is the part that must be complete: a node
 *   the model cannot see is a node it cannot patch, and ids are how patches land.
 * - **detail** for the nodes the request implicates, as the JSON they really are.
 * - **`we_template`**, to fetch any subtree by id or find nodes by what they say.
 *
 * ## Why eliding props is safe and eliding children is not
 *
 * `mergeNode` is JSON Merge Patch: keys in the patch win, absent keys are preserved, nested
 * objects merge. So patching `props` on a node whose props were never shown keeps what was not
 * mentioned — the model cannot destroy what it did not see.
 *
 * Arrays do not merge, they REPLACE. A model that has only seen a node in outline and sends
 * `node: { children: [...] }` therefore deletes every child it did not think to retype. That is
 * why `insert` and `remove` exist, and why the note below tells the model to use them. The danger
 * is specific to bounded mode: with the whole template in front of it, retyping a children array
 * is merely wasteful.
 *
 * ## It must be given a compacted, numbered tree
 *
 * Ids are the whole addressing scheme, and an authored template ALIASES — a fragment called twice
 * with the same arguments returns the same object, so numbering one gives several positions the
 * same id (62 of them on `kanbanTemplate`, 343 on `workshopTemplate`). Compaction gives every use
 * its own `$ref` and the duplicates go. `EditorStore` compacts before numbering for this reason;
 * everything here assumes it has.
 */
import type { ConversationTool, ConversationToolCall } from '@we/backend-shared';
import { definitionsOf, type OutlineEntry, outlineOf, type SchemaNode } from '@we/schema-shared';

/**
 * How much template to send before switching to an outline, in characters.
 *
 * Sized so the templates people actually edit today mostly fit — `kanbanTemplate` is 39K
 * compacted and `twitterTemplate` 27K — while the two that cannot be edited at all
 * (`workshopTemplate` at 400K, `cardsView` at 464K) do not. A character budget rather than a
 * token one because it is the thing we can measure exactly and cheaply; the ratio is about four.
 */
export const DEFAULT_TEMPLATE_BUDGET = 60_000;

/**
 * How much of the budget may go on preselected detail.
 *
 * The outline is NOT charged against the budget, and that is a real limit rather than an
 * oversight. Every node has to stay addressable — a node missing from the outline cannot be
 * patched, and the symptom is not an error but the model editing the nearest node it can see —
 * so the outline is a floor the budget cannot push below. It scales with the node count:
 * `kanbanTemplate` 4,776 characters, `workshopTemplate` 96,706.
 *
 * So bounding turns 400K into ~100K on the worst template here, not into 60K. Getting under the
 * floor needs a PARTIAL outline — subtrees the request does not touch collapsed to a "+N nodes"
 * marker that `we_template` expands — which is a bigger change and wants the eval first.
 */
const DETAIL_SHARE = 0.5;

/** A subtree bigger than this is never preselected whole — it would spend the budget on one node. */
const MAX_DETAIL_NODE = 8_000;

export interface BoundedTemplate {
  /** What goes in the user turn in place of the template. */
  sent: unknown;
  /** True when the whole template was sent, so nothing was elided and no tool is needed. */
  whole: boolean;
  tools: ConversationTool[];
  resolveTool?: (call: ConversationToolCall) => string | undefined;
  /** Sizes, for the eval and for `devLog`. `outlineChars` is the floor — see `DETAIL_SHARE`. */
  stats: {
    templateChars: number;
    sentChars: number;
    outlineChars: number;
    outlineNodes: number;
    detailNodes: number;
  };
}

/** One outline line: `n12 we-text — Boards`, indented by depth. */
const line = (entry: OutlineEntry) =>
  `${'  '.repeat(entry.depth)}${entry.id || '?'} ${entry.type}${entry.clue ? ` — ${entry.clue}` : ''}`;

/**
 * The whole tree as ids, types and clues — the root, then each shared shape under its name.
 *
 * `outlineOf` does not descend into `$defs`, which is right for its own job (outlining one split
 * copy) and wrong here: on a compacted template the definitions hold the shapes that are used
 * most, so leaving them out would hide the card from a board's outline entirely. Each is listed
 * once, under the name its `$ref`s point at, which is also how the template itself says it.
 */
export function outlineText(schema: SchemaNode): { text: string; nodes: number } {
  const root = outlineOf(schema, Number.MAX_SAFE_INTEGER);
  const parts = [root.entries.map(line).join('\n')];
  let nodes = root.entries.length;

  for (const [name, definition] of Object.entries(definitionsOf(schema))) {
    const outline = outlineOf(definition, Number.MAX_SAFE_INTEGER);
    nodes += outline.entries.length;
    parts.push(
      `\n$defs.${name} — the shape every $ref to "${name}" stands for:\n${outline.entries.map(line).join('\n')}`,
    );
  }

  return { text: parts.join('\n'), nodes };
}

/** Every node of the tree and of its definitions, by id. */
function nodesById(schema: SchemaNode): Map<string, SchemaNode> {
  const found = new Map<string, SchemaNode>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(visit);
    const node = value as SchemaNode;
    if (typeof node.type === 'string' && typeof node.id === 'string' && !found.has(node.id)) found.set(node.id, node);
    Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(schema);
  return found;
}

/** The words of a request worth matching on — long enough to mean something. */
const wordsOf = (request: string) =>
  (request.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((word) => !STOP_WORDS.has(word));

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'this',
  'that',
  'with',
  'from',
  'should',
  'would',
  'make',
  'add',
  'change',
  'set',
  'put',
  'use',
  'show',
  'hide',
  'remove',
  'give',
  'want',
  'need',
  'please',
  'can',
  'you',
  'into',
  'onto',
  'when',
  'where',
  'what',
  'which',
  'every',
  'each',
  'all',
  'one',
  'its',
  'their',
  'template',
  'page',
  'instead',
  'rather',
  'than',
  'like',
  'look',
  'leave',
  'alone',
  'there',
]);

/**
 * How well a node answers the request, by the words it says.
 *
 * Deliberately shallow: the clue and the type, matched against the request's own words. A node
 * whose text the request quotes is almost always the subject — "the heading that says Boards" —
 * and nothing cleverer is justified before the eval says this is not enough.
 */
function relevance(entry: OutlineEntry, words: string[]): number {
  const haystack = `${entry.type} ${entry.clue}`.toLowerCase();
  return words.reduce((score, word) => score + (haystack.includes(word) ? word.length : 0), 0);
}

/**
 * The template bounded to a budget, with what fetches the rest.
 *
 * `schema` must be compacted and numbered — see the note at the top of this file.
 */
export function boundTemplate(
  schema: SchemaNode,
  request: string,
  budget: number = DEFAULT_TEMPLATE_BUDGET,
): BoundedTemplate {
  const templateChars = JSON.stringify(schema).length;

  if (templateChars <= budget) {
    return {
      sent: schema,
      whole: true,
      tools: [],
      stats: { templateChars, sentChars: templateChars, outlineChars: 0, outlineNodes: 0, detailNodes: 0 },
    };
  }

  const { text, nodes } = outlineText(schema);
  const byId = nodesById(schema);
  const words = wordsOf(request);

  /*
    Spend the detail budget on the best-scoring nodes, biggest score first, skipping anything
    already covered by a node above it — a parent's detail contains its children's, so paying for
    both buys nothing.
  */
  const root = outlineOf(schema, Number.MAX_SAFE_INTEGER).entries;
  const ranked = root
    .map((entry) => ({ entry, score: relevance(entry, words) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  /*
    Overlap is skipped in BOTH directions. Skipping descendants of what is already shown is the
    obvious half; the other half is that these are ranked by score and not by depth, so a child
    can outscore its parent, be taken first, and the parent then arrive looking untaken — and
    paying for the parent buys the child a second time. On a request that matches a deep subtree
    that double-spend is most of the budget.
  */
  const shown: Record<string, unknown> = {};
  const inside = new Set<string>();
  const roots = new Set<string>();
  let spent = 0;
  for (const { entry } of ranked) {
    if (inside.has(entry.id)) continue;
    const node = byId.get(entry.id);
    if (!node) continue;
    const subtree = nodesById(node);
    if ([...roots].some((id) => subtree.has(id))) continue;
    const json = JSON.stringify(node);
    if (json.length > MAX_DETAIL_NODE) continue;
    if (spent + json.length > budget * DETAIL_SHARE) break;
    shown[entry.id] = node;
    roots.add(entry.id);
    spent += json.length;
    for (const id of subtree.keys()) inside.add(id);
  }

  const sent = {
    note:
      'This template is too large to send whole. `outline` is EVERY node — its id, its type and a ' +
      'clue about what it says — and `shown` is the full JSON of the few the request seemed to be ' +
      'about. Call `we_template` for any other node before editing it; patch by id as usual. ' +
      "IMPORTANT: to change a node's children, use the patch `insert` and `remove` operations. " +
      'Sending `node: { children: [...] }` REPLACES the whole array, which deletes the children ' +
      'you were not shown.',
    outline: text,
    shown,
  };

  const detail = (id: string): string => {
    const node = byId.get(id);
    return node ? `${id}:\n${JSON.stringify(node, null, 2)}` : `No node "${id}". Ids are in the outline.`;
  };

  const find = (needle: string): string => {
    const match = needle.toLowerCase();
    const hits = root.filter((entry) => `${entry.type} ${entry.clue}`.toLowerCase().includes(match));
    if (!hits.length) return `Nothing in the template matches "${needle}".`;
    return [`Nodes matching "${needle}":`, ...hits.slice(0, 40).map(line)].join('\n');
  };

  return {
    sent,
    whole: false,
    stats: {
      templateChars,
      sentChars: JSON.stringify(sent).length,
      outlineChars: text.length,
      outlineNodes: nodes,
      detailNodes: Object.keys(shown).length,
    },
    tools: [
      {
        name: 'we_template',
        description:
          'Read parts of the template being edited. `ids` returns those nodes in full, with their ' +
          'props and children; `find` lists the nodes whose type or text matches. Fetch a node ' +
          'before editing it unless it is already in `shown`.',
        parameters: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: 'Node ids from the outline, e.g. "n12".' },
            find: { type: 'string', description: 'Text or a type to search the outline for, e.g. "Load more".' },
          },
        },
      },
    ],
    resolveTool: (call) => {
      if (call.name !== 'we_template') return undefined;
      const args = call.arguments as { ids?: unknown; find?: unknown };
      const parts = [
        ...(Array.isArray(args.ids) ? args.ids : []).map(String).map(detail),
        ...(typeof args.find === 'string' && args.find.trim() ? [find(args.find)] : []),
      ];
      return parts.length ? parts.join('\n\n') : 'Nothing was asked for. Pass `ids`, `find`, or both.';
    },
  };
}
