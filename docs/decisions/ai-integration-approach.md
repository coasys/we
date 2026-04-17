# Decision: AI Integration — Extend AD4M vs Direct in We

## Context

AD4M already provides an integrated AI service that supports remote model configuration (base URL, API key, model name) and local models. The question is whether We's AI assistant (chat with tool calling) should route through AD4M's AI service or integrate directly with LLM providers.

## AD4M AI Service — What It Provides Today

- **Model management**: Add/remove models, set defaults per type (LLM, embedding, transcription)
- **Remote APIs**: OpenAI-compatible endpoints with configurable base URL, API key, and model
- **Local models**: Llama, Whisper, Bert via Kalosm runtime
- **Task-based prompting**: `AITask` with system prompt + few-shot examples
- **API**: `aiPrompt(taskId, prompt: string) → string` via GraphQL
- **Streaming subscriptions**: Already used for transcription (same pattern needed for LLM streaming)
- **Billing/credits**: Built-in compute credit system

### What It Lacks for Tool Calling

- No tool/function definitions in request (`ChatInput` struct has no `tools` field)
- No streaming for LLM responses (only for transcription)
- No multi-turn conversation state — each call is stateless
- Response parsing only extracts `.content` text (no `tool_calls`)
- Client API is `aiPrompt(taskId, string) → string` — no messages array

## Decision

**Extend AD4M's AI service to support chat completions with tool calling. Use direct integration in We only as a short-term bridge while the AD4M API is extended.**

## Rationale

### AD4M is the right architectural boundary

AD4M is the platform layer — it should own the LLM interface. This means any AD4M app (not just We) gets tool-calling AI for free. The calling app still controls everything domain-specific: tool definitions, the execution loop, and what to do with results.

### The required AD4M changes are narrow and well-defined

AD4M doesn't need to understand tools or manage conversation state. It just needs a richer request/response format:

1. **New GraphQL mutation**: `aiChatCompletion(messages: [ChatMessage], tools: [ToolDefinition]) → ChatCompletionResponse`
2. **Extend `ChatInput`**: Add `tools` field (or replace `chat_gpt_lib_rs` with a more complete client)
3. **Parse structured responses**: Return `tool_calls` from the response, not just `.content` text
4. **Streaming via subscriptions**: AD4M already uses GraphQL subscriptions for transcription — same pattern

### The calling app owns the logic

```
We App (owns the logic)              AD4M (owns the LLM gateway)
├── Tool definitions                 ├── Model config + API keys
├── Tool execution loop              ├── aiChatCompletion(messages, tools)
├── Conversation state               ├── Streaming via subscriptions
├── Schema/perspective tools         ├── Response parsing (content + tool_calls)
└── UI                               └── Provider abstraction
```

We sends messages + tool schemas → AD4M forwards to the configured LLM → returns structured response including any `tool_calls` → We executes tools locally → sends results back → repeat until done.

### Earlier concerns about AD4M routing, reconsidered

| Initial Concern                        | Reality                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------- |
| "Dependency bottleneck / two repos"    | The AD4M change is a one-time API extension, not ongoing feature coupling   |
| "Round-trip overhead via GraphQL"      | Negligible vs LLM inference time (seconds). Local GraphQL hop is <1ms       |
| "Streaming through GraphQL is painful" | AD4M already does streaming subscriptions for transcription — same pattern  |
| "Wrong abstraction layer"              | Actually the right one — AD4M abstracts the provider, app defines the tools |

### No credential duplication

One place to configure models, API keys, and provider endpoints. We reads model config from AD4M — users set up once.

## Provider Strategy

### Don't lock to a single provider

AD4M already supports any OpenAI-compatible endpoint. The tool-calling extension should maintain this:

- **OpenAI / Anthropic / Google** via remote API with user's key
- **Local models** via Ollama or similar for privacy-minded users
- **Any OpenAI-compatible endpoint** (LM Studio, vLLM, Together, Groq, etc.)

### On custom-trained models (future)

A custom model fine-tuned for We's schema system and tools would be attractive:

- Better schema generation trained on the DSL/token system
- More reliable tool calling for specific tool definitions
- Smaller model runnable locally, no API costs

But it requires significant training data (thousands of quality examples), ongoing maintenance as schemas/tools evolve, and real usage data to train on. This is a **Phase 3** optimization — start by accumulating real usage patterns from the tool-calling system, then use that data to fine-tune later.

## Phased Approach

### Phase 1: Direct integration in We (short-term bridge)

- Use Vercel AI SDK or OpenAI SDK directly in We's Electron main process
- Get tool calling working, iterate on tool definitions
- Provider-agnostic from the start (user configures provider + key)
- Read AD4M's model config via `aiGetModels()` to avoid credential duplication

### Phase 2: Extend AD4M's AI service

- PR to AD4M adding `aiChatCompletion(messages[], tools[])` + streaming subscription
- Scope is well-defined: new mutation, extended input types, structured response parsing
- Migrate We's AI chat to use the AD4M API
- Tool definitions and loop logic in We stay the same — only the transport layer changes

### Phase 3: Custom model (long-term, if warranted)

- Fine-tune a small model on accumulated usage data from Phase 1/2
- Real schema examples, real tool call patterns
- Target specific tasks where fine-tuning provides clear value over prompt engineering

## Consequences

- **Platform benefit** — All AD4M apps get tool-calling AI, not just We
- **No duplication** — single model/key configuration in AD4M
- **Right boundary** — AD4M owns provider abstraction, apps own domain logic
- **Phased risk** — direct integration lets We ship immediately while AD4M API is extended
- **Migration path** — Phase 1 → Phase 2 swap is transport-layer only, tool definitions unchanged
