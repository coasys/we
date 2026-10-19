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
