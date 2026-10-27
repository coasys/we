/**
 * toolset — the shape every set of WE tools takes, for a host that runs agents.
 *
 * A host is anything that holds a conversation with a model and lets it call tools: the AD4M
 * executor's tool list, an MCP server, a test. It offers a toolset's tools to whichever agent it
 * is running, beside its own, and answers each call by passing it here with the record it names.
 *
 * **A toolset holds nothing between calls.** Every call is given the record as it is stored now and
 * answers from that alone, so a host needs no session, two agents can use the same tools at once,
 * and a call can come from anywhere a host's tools reach. What a call should change comes back as
 * properties, and the host writes them: the rules stay in WE, and storage stays with the host.
 *
 * **Nothing here prompts a model.** What an agent needs to know beyond the tool descriptions is
 * documentation, which the host serves beside its own and the agent reads when it decides to.
 *
 * A failed call answers with text starting `Error: `, never a throw. The model reads the error,
 * fixes its call and tries again, which is how an edit converges; a throw would end the
 * conversation instead. A throw from `call` means the host did something wrong, not the model —
 * a record of the wrong entity, or one with nothing readable in it.
 *
 * **A tool that creates answers with the new record, and the host makes it.** Its answer names the
 * entity and the place (`ToolAnswer.create`), so what a new record holds stays WE's to decide —
 * which fields, how a file is encoded, what a valid one is — and where it is made stays the host's.
 */
import type { EntityManifestEntry } from '@we/backend-shared';

export interface AgentTool {
  name: string;
  /** What the model is told the tool is for. */
  description: string;
  /**
   * The tool's own arguments, as JSON Schema. The record a call is about is not among them: the
   * host adds its own way of naming one, and passes the record it names to `call`.
   */
  parameters: Record<string, unknown>;
  /**
   * Whether a call can come back with properties to write. A host that lets an agent write only
   * through tools it allowed checks this rather than knowing the tool.
   */
  writes: boolean;
  /**
   * Present on a tool that makes a new record rather than changing the one a call names: which
   * entity it makes, and where one may go. The call says which of those places it wants
   * (`ToolAnswer.create`), and a host refuses an answer naming a place not listed here.
   */
  creates?: { entity: string; places: Place[] };
}

/**
 * Where a new record goes. `library` is the person's own, which nobody else sees; `space` is the
 * space the agent is working in, which every member sees. Which dataset each one is, is the host's
 * to know.
 */
export type Place = 'library' | 'space';

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

export interface ToolCall {
  /**
   * The record the call names, as it is stored now. A tool that edits needs one. A tool that
   * creates may be given one to start from (a template to fork), and otherwise none.
   */
  record?: RecordInput;
  /** The tool's arguments, as the parsed object or the JSON string a provider sent. */
  args: unknown;
  /** The dataset's own models, which the record may name. See `TemplateToolsetOptions.models`. */
  models?: EntityManifestEntry[];
  /**
   * Who a write will go out as — the agent's DID. Recorded in what is written, which is how the
   * app tells this agent's own change (applied on every device) from somebody else's (offered).
   * Absent, the change reads as somebody else's.
   */
  author?: string;
}

export interface ToolAnswer {
  /** What the model is told. Starts `Error: ` when the call was refused. */
  text: string;
  /**
   * The properties to write, when the call changed the record — encoded as the app writes them, a
   * file property as the FileData it is stored from. Every one of them in ONE write, since the app
   * reads them as one change. Absent when there is nothing to write.
   */
  properties?: Record<string, unknown>;
  /**
   * Set when `properties` are a new record's rather than changes to the one the call named: the
   * host makes a record of `entity` in `place`, and tells the agent its id.
   */
  create?: { entity: string; place: Place };
}

/** A documentation topic, listed without its text. */
export interface DocEntry {
  /** What a host asks for it by — `template`, `template/components/we-button`. */
  path: string;
  title: string;
  /** One line, for a list of topics. */
  summary: string;
}

/**
 * Tools for one kind of record, and the documentation that explains them — the whole surface a
 * host needs. Decoding a record and encoding what changed stay in WE, so a host never learns how a
 * template is stored.
 */
export interface RecordToolset {
  /** The entities these tools work on. */
  appliesTo: string[];
  tools: AgentTool[];
  /** Answer one call. A tool this toolset does not have answers with an error, like any refused call. */
  call(name: string, input: ToolCall): Promise<ToolAnswer>;
  docs: {
    /** Every topic, the one to start from first. */
    list(): Promise<DocEntry[]>;
    /** One topic's text, or undefined for a path that is not one. */
    read(path: string): Promise<string | undefined>;
  };
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
