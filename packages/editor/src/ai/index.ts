/**
 * The AI-assisted half of the editor.
 *
 * A separate entry point rather than a separate package. What a deployment without an API key needs
 * is to not *ship* this code, which is an import-level property — `@we/editor` vs `@we/editor/ai`
 * with `sideEffects: false` gets exactly that. A package boundary buys install-level optionality,
 * which matters for heavy or licensed dependencies; this is fetch calls and prompt strings.
 *
 * The boundary is still real and still enforced: `src/core/**` must not import `src/ai/**`. That
 * keeps a later extraction a `git mv` rather than a redesign — for the day a second consumer exists,
 * or the assistant grows install-heavy dependencies, or someone ships an alternative panel through
 * the marketplace. Until then, minting the package would be a boundary drawn before the thing it
 * divides exists.
 */
export { AiPanel } from './AiPanel';
