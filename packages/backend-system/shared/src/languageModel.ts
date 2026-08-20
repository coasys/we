/**
 * One-shot text generation against the backend's own language model.
 *
 * The backend, not the agent: WE's other AI surfaces already work this way — transcription and
 * interpretation both run on models the node operator configured — and the first consumer here
 * (model authoring in the wizard) was the odd one out, gated on a personal Anthropic key that only
 * the template editor ever set. Availability should mean "this node has a model", which every
 * member of a space can be true for at once, rather than "this agent pasted a key".
 *
 * Deliberately minimal: one system prompt, one input, one text back. Conversation state, output
 * schemas and repair loops belong to the caller — a port that modelled chat would be wedded to one
 * provider's message shapes, which is how the key-gated path happened.
 */
export interface LanguageModelPort {
  /** Whether this backend has a language model to prompt — what an AI affordance gates on. */
  available(): Promise<boolean>;
  /** Send one prompt through the backend's default language model and return its text. */
  prompt(system: string, input: string): Promise<string>;
}
