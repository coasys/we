/**
 * toolset — the shape every set of WE tools takes, for a host that runs an agent.
 *
 * A host is anything that holds the conversation with a model and lets it call tools: the AD4M
 * executor's harness, an MCP server, a test. It needs three things from WE, and a toolset is
 * exactly those: what to tell the model (`system`, `prompt`), what the model may call (`tools`),
 * and the answer to a call (`call`). When the conversation ends, `result` says what came of it.
 *
 * The rules stay in WE and the loop stays with the host. A toolset never stores anything: an edit
 * changes the toolset's own working copy, and the host decides what to do with the result — save
 * it, propose it for approval, or throw it away.
 *
 * A failed call answers with a string starting `Error: `, never a throw. The model reads the
 * error, fixes its call and tries again, which is how an edit converges; a throw would end the
 * conversation instead. A throw from `call` means the host did something wrong, not the model.
 */
import type { EntityManifestEntry } from '@we/backend-shared';

export interface AgentTool {
  name: string;
  /** What the model is told the tool is for. */
  description: string;
  /** The arguments, as JSON Schema. */
  parameters: Record<string, unknown>;
  /**
   * `lookup` only reads; `edit` changes the toolset's working copy. Neither touches storage —
   * see `Toolset.result`.
   */
  kind: 'lookup' | 'edit';
}

export interface Toolset<Result> {
  /** The system prompt. */
  system: string;
  /** The first user turn: the request, and whatever the model needs to see beside it. */
  prompt: string;
  tools: AgentTool[];
  /**
   * Answer one call. `args` may be the parsed object or the JSON string a provider sent. A tool
   * this toolset does not have answers with an error, like any other refused call.
   */
  call(name: string, args: unknown): Promise<string>;
  /** What the conversation produced so far. Safe to read at any point, and as often as wanted. */
  result(): Result;
}

/**
 * A stored record, as a host hands it to a toolset: the properties it read, with any file a
 * property holds already resolved (a `data:` URI, or the JSON itself).
 */
export interface RecordInput {
  id: string;
  /** The entity the record is, as the model manifest names it — `Template`. */
  className: string;
  properties: Record<string, unknown>;
}

export interface RecordToolsetInput {
  record: RecordInput;
  /** What the person asked for, in their words. */
  request: string;
  /** The dataset's own models, which the record may name. See `TemplateToolsetOptions.models`. */
  models?: EntityManifestEntry[];
  /**
   * Who the write will go out as — the agent's DID. Recorded in what is written, which is how the
   * app tells this agent's own change (applied on every device) from somebody else's (offered).
   * Absent, the change reads as somebody else's.
   */
  author?: string;
}

/** What a conversation about one record produced: the properties to write back, if any. */
export interface RecordEdit {
  /** Whether anything was kept. Write nothing when false. */
  changed: boolean;
  /**
   * The properties to write, encoded as the app writes them — a file property as the FileData it
   * is stored from. Every one of them in one write, since the app reads them as one change.
   */
  properties: Record<string, unknown>;
}

/**
 * Toolsets by what they edit — the one surface a host needs. The host finds the toolset whose
 * `appliesTo` names the record's entity, opens it on the record, runs the conversation, and writes
 * `result().properties` back. Decoding the record and encoding what changed stay in WE, so a host
 * never learns how a template is stored.
 */
export interface RecordToolsetEntry {
  /** The entities this toolset edits. */
  appliesTo: string[];
  /** Rejects when the record is not one this toolset can read — that is the host's mistake, not the model's. */
  open(input: RecordToolsetInput): Promise<Toolset<RecordEdit>>;
}

/** Arguments as an object, whether they arrived parsed or as the JSON a provider sent. */
export function readArguments(args: unknown): Record<string, unknown> | undefined {
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return undefined;
    }
  }
  return args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : undefined;
}
