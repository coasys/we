# A space's own model is stored once, in the form its backend uses, and read back as a manifest

**Status:** Accepted — 2026-10-25

**Decision.** A model a space defined for itself is kept in exactly one form: the one its backend's
own schema uses. WE speaks about it as an `EntityManifest` — the wizard, the AI, the validator and a
bundle all read and write one — and a backend's `SchemaPort.shapes` translates both ways. Where a
backend has no schema language of its own, the manifest _is_ what it stores, as a document on a
`Shape` record (`createJsonShapeStore`). Where it has one, the model is that schema, with what the
schema cannot say written beside it as annotations on the schema's own nodes — never as a second
document. The presentation a community chooses for a type (a card's title, a field's control) is
not part of the model; it is a `TypeStyle` override laid over the model's defaults
([`presentation.ts`](../../../packages/app-shell/src/shared/shapes/presentation.ts)).

**Why.** Two copies of one model can disagree, and did: a manifest document and the schema compiled
from it were held together by a staleness check, and anything that edited the schema directly was
either invisible to WE or overwritten by it from the document on the next install. One copy cannot
drift, and an edit made by other software is read rather than reverted. The manifest stays the one
format above the backend because it is small, closed and checkable — what a model can write reliably
and the validator can judge — and because a change to how a backend spells a schema then lands in
one adapter rather than in every template, store and prompt. Presentation sits apart because it
changes often, for reasons that are not about what the thing is: a community retitling its cards must
not change the model, bump its version, or mark it changed against wherever it came from.

**Rejected.**

- _The manifest as the truth, with the backend's schema kept as a second copy and synced._ Once both
  can be written, one has to win. If the schema wins — and it must, since it is what the backend acts
  on — the document is a cache that lags; if the document wins, edits made to the schema are reverted.
  A sync between independent writers also races on every peer that notices. Load speed, its one real
  benefit, is a cache on the client, not a copy in the space.
- _The backend's schema language as WE's model format._ It would make every surface above the backend
  depend on one backend's spelling, and none of them reads it as well as a manifest is read and
  written.
- _A separate record holding a model's annotations._ It would be governed apart from the schema it
  annotates, and could be changed past whatever governs the schema.

**Revisit when.** A backend needs a model to carry something the manifest cannot say and that matters
above the backend. Then the manifest grows; it does not gain a second home.
