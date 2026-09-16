/**
 * Text generation against the backend's own language model.
 *
 * The backend, not the agent: WE's other AI surfaces already work this way — transcription and
 * interpretation both run on models the node operator configured — and the first consumer here
 * (model authoring in the wizard) was the odd one out, gated on a personal Anthropic key that only
 * the template editor ever set. Availability should mean "this node has a model", which every
 * member of a space can be true for at once, rather than "this agent pasted a key".
 *
 * Two shapes. `prompt` is one system prompt, one input, one text back, and suits anything whose
 * repair loop is its own. `converse` is a conversation that can call tools, which the template
 * editor needs: it hands the model a patch tool and feeds validation errors back to it. Its turns
 * are this contract's own rather than any provider's message format — a port wedded to one
 * provider's shapes is how the key-gated path happened — and the backend translates them to
 * whatever wire it speaks.
 */
export interface LanguageModelPort {
  /** Whether this backend has a language model to prompt — what an AI affordance gates on. */
  available(): Promise<boolean>;
  /** Send one prompt through the backend's default language model and return its text. */
  prompt(system: string, input: string): Promise<string>;
  /**
   * One turn of a tool-calling conversation with the backend's default language model.
   *
   * Optional: a backend that can prompt but not converse omits it, and a caller that needs it says
   * so rather than degrading to `prompt`. Resolves when the model has finished its turn; text
   * arriving before then is reported through `onText`.
   */
  converse?(request: ConversationRequest): Promise<ConversationReply>;
}

/** A tool the model may call. `parameters` is a JSON Schema object describing the arguments. */
export interface ConversationTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A call the model asked for, with its arguments already parsed. */
export interface ConversationToolCall {
  /** Pairs the call with its result. Assigned by the backend; echoed back unchanged. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * One turn of the conversation so far.
 *
 * A tool result is its own turn rather than a user message carrying one, because that is the one
 * point every provider agrees on and the one where translating wrongly breaks the request: each
 * call has to be answered by exactly one result naming it.
 */
export type ConversationTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls?: ConversationToolCall[] }
  | { role: 'tool'; callId: string; result: string };

export interface ConversationRequest {
  system: string;
  turns: ConversationTurn[];
  tools?: ConversationTool[];
  /** Everything the model has written so far this turn, each time more arrives. */
  onText?: (textSoFar: string) => void;
  signal?: AbortSignal;
}

export interface ConversationReply {
  text: string;
  calls: ConversationToolCall[];
  /**
   * Why the turn ended. `truncated` is its own answer rather than folded into `done`: a reply cut
   * off mid-call has dropped the call, and reporting that as finished tells the user an edit
   * happened that did not.
   */
  finish: 'done' | 'tool_calls' | 'truncated';
}
