# Plan: Provider-Agnostic AI Client (Phase 1)

> **Goal:** Replace WE's hand-rolled, Anthropic-only chat client with a provider-agnostic one, so any OpenAI-compatible endpoint (Hex, AD4M's new `/v1` surface, OpenRouter, local vLLM, etc.) — as well as Anthropic — can be configured without code changes. This is Phase 1 from [`ai-integration-approach.md`](../../decisions/ai-integration-approach.md), executed as originally decided rather than left as a partial Claude-only implementation.

---

## Motivation

WE's AI chat (schema generation via `AiStore`) currently talks directly to `https://api.anthropic.com/v1/messages` with a hand-written `fetch` + SSE parser. This blocks two things:

1. **Experimentation with other providers.** A teammate wants to try WE against a Hex-hosted model (and eventually AD4M's own OpenAI-compatible endpoint once it lands) — today that requires code changes, not a settings change.
2. **A latent security smell.** The Anthropic API key lives in `AgentSettings` and is used directly from the Solid renderer via `fetch(..., { headers: { 'anthropic-dangerous-direct-browser-access': 'true' } })` — the header name is Anthropic's own warning label for this pattern. Worth fixing regardless of the provider question, especially before WE is used as a "daily driver from a phone."

This plan **only** covers the WE-side client. It does not touch AD4M's native AI service (that's Phase 2, a separate, larger platform change — see `ai-integration-approach.md`). Registering a remote model in AD4M itself already works today and is unaffected by this work.

---

## Current State (as of investigation)

All of this lives in one file: `packages/app-shell/src/frameworks/solid/stores/AiStore.tsx` (1594 lines). No AI SDK is installed (`@anthropic-ai/sdk` is not a dependency) — everything is hand-rolled JSON against a REST endpoint, which is actually good news for portability: there's no typed SDK object model to unwind.

| Piece                   | Location                                                                       | Notes                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API key field           | `packages/models/src/entities/AgentSettings.ts:19-20`                          | `claudeApiKey: string`, AD4M `@Property` (`we://claude_api_key`) — name is provider-specific                                                               |
| Request construction    | `AiStore.tsx:955-991` (`sendClaudeRequest`)                                    | Raw `fetch('https://api.anthropic.com/v1/messages', ...)`, hardcoded model string (`claude-sonnet-4-6`, line 978), hardcoded `max_tokens: 16384`           |
| Tool definition         | `AiStore.tsx:149-211` (`updateSchemaTool`)                                     | One tool, Anthropic's `input_schema` shape (plain JSON Schema — portable)                                                                                  |
| System prompt + caching | `AiStore.tsx:982-988`                                                          | `system: [{ type: 'text', text: chatSystemPrompt, cache_control: { type: 'ephemeral' } }]` — Anthropic-specific prompt-caching marker, one breakpoint only |
| SSE parsing             | `AiStore.tsx:867-952` (`parseSSEStream`)                                       | Hand-parses Anthropic's event types (`content_block_start/delta/stop`, `message_delta`)                                                                    |
| Agentic tool loop       | `AiStore.tsx:1007-~1200` (`sendViaClaude`)                                     | Up to 5 continuation turns; builds conversation history as Anthropic content-block arrays; applies `update_schema` patches                                 |
| Message building        | `AiStore.tsx:1356-1393` (`buildClaudeMessages`)                                | Embeds full template JSON + request into each user turn                                                                                                    |
| Entry point             | `AiStore.tsx:829` (`sendMessage`)                                              | Real entry point — `we/CLAUDE.md`'s documented `handleSchemaPrompt` name is stale and should be corrected separately                                       |
| Key-entry UI            | `packages/app-shell/src/frameworks/solid/components/editor/AiPanel.tsx:74-110` | Single-field gate: "Enter your Anthropic API key..." — needs to become a small provider-config form                                                        |
| Settings persistence    | `AdamStore.tsx:~753-760`                                                       | `setApiKey` → `Object.assign(settings, updates); await settings.save()` via the AD4M model directly — no separate backend call, this plumbing stays as-is  |

Feature surface actually in use is narrow: no extended thinking, no multi-block/complex tool responses, no server-side tools, one tool definition, one cache breakpoint. This is a shallow integration, which makes the swap more contained than the file size suggests.

---

## Design

### 1. Generalize `AgentSettings`

Replace the single `claudeApiKey` field with a small provider-config shape. Options: either a flat set of fields, or a JSON blob — recommend flat fields for query/UI simplicity, mirroring AD4M's own `ModelApiInput` shape (`{baseUrl, apiKey, model, apiType}`) so it composes cleanly if/when Phase 2 lands:

```ts
aiProvider: string = 'anthropic'; // 'anthropic' | 'openai-compatible'
aiBaseUrl: string = ''; // empty = provider default
aiApiKey: string = ''; // renamed from claudeApiKey
aiModel: string = 'claude-sonnet-4-6'; // currently hardcoded, needs to become configurable
```

Needs a migration path for existing `claudeApiKey` values (see Open Questions).

### 2. Replace the hand-rolled client with an SDK

Recommend the **Vercel AI SDK** (`ai` package) over hand-rolling a second protocol parser: it already normalizes tool calling + streaming across OpenAI-shaped and Anthropic-shaped backends behind one interface (`streamText`), and supports passing provider-specific options (including Anthropic's `cache_control`) through `providerOptions` without forcing a lowest-common-denominator feature set.

This means deleting, not porting, most of the current file:

- `parseSSEStream` (867-952) — replaced by the SDK's stream handling entirely.
- `sendClaudeRequest` (955-991) — replaced by a `streamText({ model, system, messages, tools })` call with a provider adapter chosen from `AgentSettings`.
- The Anthropic-content-block-shaped parts of `sendViaClaude` (tool call extraction, `stop_reason` checks) — replaced by the SDK's normalized tool-call/finish-reason shape.

What stays essentially as-is:

- `updateSchemaTool`'s JSON Schema (149-211) — portable as long as the SDK accepts plain JSON Schema for tool parameters (it does).
- The patch-application / continuation-loop _logic_ (apply `update_schema` results to `templateStore`, keep looping while there are tool calls) — this is WE's own logic, not Anthropic's.
- `buildClaudeMessages` (1356-1393) — the _content_ it builds is provider-agnostic already (plain JSON in message text); only the outer envelope changes.
- Settings persistence via `AdamStore` / AD4M model `.save()`.

### 3. Prompt caching — accept the loss for non-Anthropic providers, keep it for Anthropic

The single `cache_control: {type: 'ephemeral'}` breakpoint on the system prompt is Anthropic-specific; OpenAI-shaped endpoints do automatic server-side prefix caching with no client-side marker, so this becomes a no-op removal when `aiProvider !== 'anthropic'`, not a hard port. When still targeting Anthropic (the common case today), pass it through via the SDK's `providerOptions.anthropic.cacheControl` so the cost/latency behavior doesn't regress for existing users.

### 4. Settings UI

`AiPanel.tsx`'s current single "Enter your Anthropic API key" field (74-110) becomes a small form: provider select (Anthropic / OpenAI-compatible), base URL (shown only for OpenAI-compatible, or always with a sensible placeholder), API key, model name/picker. Keep it minimal — this isn't a full settings page, just enough for the gate UI to stop assuming Anthropic.

---

## Implementation Order

1. **`AgentSettings` schema change** — add the new fields, keep `claudeApiKey` temporarily for migration (see Open Questions), regenerate the AD4M model bindings.
2. **Add the Vercel AI SDK dependency**, spike a minimal `streamText` call against both an Anthropic key and an OpenAI-compatible endpoint (e.g. a local Ollama or OpenRouter key) to confirm tool-calling + streaming + `cache_control` passthrough all work before touching `AiStore.tsx`.
3. **Rewrite `sendClaudeRequest`/`parseSSEStream` → a single provider-agnostic `sendChatRequest`** using the SDK, reading provider config from the new `AgentSettings` fields.
4. **Update `sendViaClaude`'s tool-loop** to consume the SDK's normalized tool-call shape instead of Anthropic content blocks.
5. **Update `AiPanel.tsx`** with the small provider-config form.
6. **Manual smoke test**: schema generation end-to-end against both an Anthropic key and a second OpenAI-compatible provider (Hex, once available, or OpenRouter/local vLLM as a stand-in) — verify tool calls apply patches correctly and streaming renders as before.
7. **Fix the stale `handleSchemaPrompt` reference** in `we/CLAUDE.md`'s `AiStore` docs (unrelated pre-existing doc bug, cheap to fix alongside this).

---

## Out of Scope

- AD4M's native `aiPrompt`/`aiChatCompletion` GraphQL surface (Phase 2 — separate plan doc, larger platform change).
- Local/on-device model support.
- Any fine-tuned/custom model work (Phase 3 in the decision doc).
- The `AI_SCOPED_SEGMENTS_PLAN.md` context-size optimization (separate, triggered by template size, not provider).

---

## Open Questions

- **Migration for existing `claudeApiKey` values**: auto-migrate on load (`claudeApiKey` → `aiProvider: 'anthropic', aiApiKey: <value>`) and deprecate the old field, or keep both indefinitely? Recommend auto-migrate once, then drop the old field in a follow-up once confirmed safe.
- **Model picker**: hardcode a short list per provider (Anthropic model names are stable/known; OpenAI-compatible endpoints vary wildly), or free-text input? Free-text is simpler and matches how AD4M's own `addModel` already works.
- **Vercel AI SDK vs. keeping a generalized hand-rolled client**: the SDK is recommended for less code and built-in multi-provider normalization, but adds a dependency and an abstraction layer to learn. Worth a quick spike (step 2 above) before committing.
- **Does the Vercel AI SDK's Anthropic provider support the exact single-breakpoint `cache_control` usage WE needs**, or does it impose its own caching strategy? Needs confirming in the spike, since this is the one place behavior could subtly regress.
