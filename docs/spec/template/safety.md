# Template format: safety

A template is meant to be safe to install from a stranger: it can name what the host lends it and
arrange what it draws, and it cannot run anything, reach past what it was granted, act without the
person asking, or stand in for the parts of the host that protect the person. Those properties are
rules a host enforces, and a host that renders somebody else's template without them renders it
unsafely. So they are part of conformance, and each comes with refusals: vectors or tests of a host
refusing what breaks it.

The rule behind every section: **a protection holds without the thing it protects against
cooperating.** None asks a template, a theme, a component or a module to remember anything; each is
enforced at one place the host owns, which every template passes through.

| Rule                                                                        | Enforced by       | Class          |
| --------------------------------------------------------------------------- | ----------------- | -------------- |
| [Capability grants](#capability-grants)                                     | the bag           | host           |
| [Gestures](#gestures)                                                       | the bag           | host           |
| [Protected pieces](#protected-pieces)                                       | the host's chrome | host           |
| [Confirmation of destructive actions](#confirmation-of-destructive-actions) | the bag           | host           |
| [Elements and URLs](#elements-and-urls)                                     | the renderer      | renderer, host |
| [Expressions are inert](#expressions-are-inert)                             | the evaluator     | renderer, host |

## Capability grants

What a template can name is **the bag**: the stores, module stores and host values the host lends
it. A host MUST build the bag from what the template was granted, and nothing else:

- **Groups are the unit of a grant.** Every member a host could lend is classified into one named
  capability group, written in the words a person reads at install time ("Read and write the content
  of this space", "Move around the app"). A template is granted groups, never single members.
- **Absent, not blocked.** A member outside the grant is **not in the bag**: a read of it is no value
  and an `$invoke` of it does nothing, exactly as for a member that does not exist. A host MUST NOT
  answer a reach past the grant with an error, a different value, or anything else a template could
  tell apart from absence.
- **State is read, actions are called.** A member classified as state is readable by expressions;
  one classified as an action is reachable only through `$invoke`. Reading an action in an
  expression is no value, so naming one can never call it.
- **Unclassified is ungranted.** A member nobody has classified is in no group and so in no bag.
- **Grants follow authorship.** What a node may name is decided by who wrote it, not where it is
  drawn: a template's node inside a host frame still has the template's grant.
- **Scope is part of the grant.** An action that could act on something other than what is on screen
  (another space than the one the template is in) is pinned to what is on screen unless the grant
  includes acting elsewhere: arguments that would name another target are dropped.

The groups and their members are a host's catalog, not this spec's. WE's are listed in its template
surface; a host's space tier SHOULD grant no more than reading and taking part in the space on screen.

> **Why absent.** An error says "this exists and you may not have it", which a hostile template can
> probe. Absence says nothing, and matches what an uninstalled module already looks like.

What any host provides, member by member and each with its group, is the
[capability profiles](../profiles/README.md): seven versioned member lists another host can provide
exactly.

---

Implemented by: [`templateSurface.ts`](../../../packages/app-shell/src/shared/registries/templateSurface.ts)
(`CAPABILITY_GROUPS`, `SPACE_TIER`, `CHROME_TIER`, `buildTemplateBag`),
[`templateAcceptance.ts`](../../../packages/app-shell/src/shared/templateAcceptance.ts).
Pinned by (the refusals): [`templateSurface.test.ts`](../../../packages/app-shell/tests/templateSurface.test.ts)
(every member classified; a member outside the tier is absent from the bag; a space action's target
argument dropped); safety vectors `safety.grant.read-absent`, `safety.grant.invoke-absent`,
`safety.grant.action-not-readable`, `safety.grant.absent-no-continuation`; [`templateAcceptance.test.ts`](../../../packages/app-shell/tests/templateAcceptance.test.ts)
(a reference past the tier is admitted and reported, never granted).

## Gestures

**An action runs only when the person asked for it.** A host MUST refuse, by doing nothing, an action
called when nobody did anything to the part of the template calling it.

- **Asking** is a trusted activation (a press, a key, typing, a drop, a paste) reaching the element
  whose handler makes the call, while it is being dispatched; and, once, whatever that element does in
  answer a moment later (a component that encodes a crop and then emits). A credit lasts a few
  seconds and reaches only the elements on the activation's path.
- **Not asking** is an event that happens to the element by itself: an image loading or failing, a
  `details` that starts open, a field taking focus on mount, an animation ending, a component reporting
  its size. Wired there, an action is refused.
- **Continuations count** as part of the press that started them: an `$invoke`'s `onSuccess`,
  `onError` and `onFinally`, and a blur after the person typed into the field.
- **Exempt** are actions that change only what this person is looking at: navigating, opening and
  closing the host's own surfaces, reporting a measurement, editing an unsaved draft. A host marks
  these and they run anywhere. Anything stored, anywhere, and anything that leaves or reaches a device
  (publishing presence, starting a call, the clipboard) is never exempt.
- **A declared operation** that writes anything is an action here; one that only reads is exempt.
- Local-state verbs (`$setLocal` and the rest) are not actions and are not gated: they change only
  the template's own memory. `$callLocal` passes on a gesture and cannot start one.

Nothing a template can express creates a gesture. A validator SHOULD warn about a write wired to an
event nobody causes.

---

Implemented by: [`gesture.ts`](../../../packages/schema-system/shared/src/gesture.ts)
(`claimGesture`, `captureGesture`, `runWithGesture`, `installGestureTracking`),
[`templateSurface.ts`](../../../packages/app-shell/src/shared/registries/templateSurface.ts)
(`gated`, `ambient`).
Pinned by (the refusals): render vectors `render.safety.gesture-refused` (a write on an event nobody causes does
not run; the same write on a press does), `render.safety.gesture-continuation`; safety vectors
`safety.gesture.exempt-runs-unasked`, `safety.gesture.on-error-continuation`,
`safety.gesture.focus-is-not-asking`;
[`gesture.test.ts`](../../../packages/schema-system/shared/src/gesture.test.ts);
[`templateSurface.test.ts`](../../../packages/app-shell/tests/templateSurface.test.ts) ("the gesture
gate": a write nobody asked for is refused, an exempt action runs).

## Protected pieces

A few parts of the host protect the person, and no template may draw, replace, cover or read them:

- **The credential field.** A screen that asks for a password places the host's field and cannot
  replace it. What is typed never becomes template state, no event carries it out of the field, and no
  action a template can name takes a password as an argument. A template learns only that something
  was entered.
- **The safety prompts.** The host's questions whose answer protects the person (consent, install,
  delete, sharing a screen, removing an account) cannot be replaced or removed by a template or a
  deployment, nothing a template opens can be drawn over one, and nothing behind one responds while
  it is open.
- **The way out.** The person can always reach the host's own templates and themes in place of the
  chosen ones (WE's safe mode), by a door no template can close: an address read before any template
  runs, a key heard before any template's handler, and a render that never finished.

A host that lets a template stand in for a protected piece does not conform.

---

Implemented by: [`CredentialField.tsx`](../../../packages/app-shell/src/frameworks/solid/components/CredentialField.tsx),
[`credential.ts`](../../../packages/app-shell/src/frameworks/solid/credential.ts),
[`safeMode.ts`](../../../packages/app-shell/src/shared/safeMode.ts).
Pinned by (the refusals): [`credentialField.test.tsx`](../../../packages/app-shell/tests/credentialField.test.tsx),
[`topLayer.browser.test.ts`](../../../packages/design-system/3-primitives/src/topLayer.browser.test.ts),
[`safeMode.test.ts`](../../../packages/app-shell/tests/safeMode.test.ts), each checked to fail with
its mechanism removed.

## Confirmation of destructive actions

A host MUST ask the person before every **destructive** action a template calls (one that cannot be
undone, or only at cost: a delete, a removal, a trust), in a confirmation the host draws in its own
words, and MUST NOT run the action when the person declines. Declined, the action answers as a
refused one does: no value, and `onSuccess` does not run.

- The question is written from the request and from the data, never from the template: what is
  deleted, and what goes with it, counted by the host.
- A declared operation is destructive when its effect summary is
  ([Operations: permission and confirmation](../operations/execution.md#permission-and-confirmation)).
- Being destructive is a flag on a member, across groups, so the confirmation holds whatever the
  template was granted.
- A template SHOULD NOT draw a confirmation of its own in front of one: the host's is already there.

The confirmation is one of the [protected pieces](#protected-pieces): the template cannot draw it,
restyle it or answer it.

---

Implemented by: [`templateSurface.ts`](../../../packages/app-shell/src/shared/registries/templateSurface.ts)
(`destructive`, `onDestructive`), [`destructiveWording.ts`](../../../packages/app-shell/src/shared/destructiveWording.ts).
Pinned by (the refusals): safety vectors `safety.confirm.declined`, `safety.confirm.accepted`,
`safety.confirm.not-for-ordinary-writes`; [`templateSurface.test.ts`](../../../packages/app-shell/tests/templateSurface.test.ts)
("destructive actions": refused by the host without the template knowing how),
[`destructiveDialog.test.ts`](../../../packages/app-shell/tests/destructiveDialog.test.ts),
[`destructiveFacts.test.ts`](../../../packages/app-shell/tests/destructiveFacts.test.ts),
[`operationSurface.test.ts`](../../../packages/app-shell/tests/operationSurface.test.ts).

## Elements and URLs

A renderer MUST enforce these whatever host it runs in, against the **resolved** value of every prop,
so an expression that builds a forbidden value is refused as surely as a literal.

**Native elements are an allowlist.** A lower-case type is mounted only when it is on the list of
elements that display, group or take input (`div`, `p`, `a`, `img`, `table`, `form`, `input`,
`details`, …). Everything else draws nothing, without a marker. Left off on purpose: `script`,
`noscript`, `style`, `link`, `meta`, `base`, `title`, `iframe`, `frame`, `frameset`, `object`,
`embed`, `portal`, `template`, `slot`, `svg` and `math`: each runs something, loads something into
the page, changes how the page resolves addresses, or makes a document of its own. A frame is the
catalog's `we-iframe`, which owns its sandbox.

**Props are refused by value.** A prop never reaches an element when it is:

- `srcdoc`, on anything;
- a lower-case `on…` prop holding text, on a native element (an inline script);
- a URL prop (`href`, `src`, `srcset`, `action`, `formaction`, `poster`, `data`, `background`,
  `ping`, `cite`, `codebase`, `manifest`, `xlink:href`) whose value starts, after white space, with
  `javascript:` or `vbscript:` (in any case), or with `data:` and is not an image, audio or video.

> **Why an allowlist.** An element nobody thought about is one nobody vetted, and HTML keeps growing.
> A denylist is right only until the next element.

---

Implemented by: [`templateElements.ts`](../../../packages/schema-system/shared/src/templateElements.ts)
(`TEMPLATE_HTML_ELEMENTS`, `refusedProp`),
[`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx).
Pinned by (the refusals): render vectors `render.safety.native-tags` (`script`, `iframe` and `svg` mount nothing),
`render.safety.native-tags-more`, `render.safety.javascript-href` (literal and computed),
`render.safety.url-schemes`, `render.safety.inline-handler-text`, `render.safety.srcdoc`;
[`templateElements.test.ts`](../../../packages/schema-system/shared/src/templateElements.test.ts).

## Expressions are inert

An expression reads data and cannot run anything ([Reach](expressions.md#reach)): no method call, no
function obtained from the bag, no read past a host object's listed fields, and the prototype names
refused. A validation `pattern` is bounded ([Validation rules](values.md#validation-rules)), and a
`$ref` cycle cannot recurse ([Shared shapes](nodes.md#shared-shapes-defs-and-ref)), so no template
can hang the page on data it chose.

The refusals of every rule above but the protected pieces are vectors a host other than WE can run:
`safety.json` for the grants, the gestures and the confirmation, `render.json` (`render.safety.*`) for
the elements and URLs ([Conformance](conformance.md#running-each-family)). The protected pieces are
host chrome no template can name, and stay pinned by the host's tests.

---

Implemented by: [`evaluate.ts`](../../../packages/schema-system/expressions/src/evaluate.ts),
[`reach.ts`](../../../packages/schema-system/expressions/src/reach.ts),
[`validation.ts`](../../../packages/schema-system/shared/src/validation.ts),
[`definitions.ts`](../../../packages/schema-system/shared/src/definitions.ts).
Pinned by (the refusals): [`reach.test.ts`](../../../packages/schema-system/expressions/src/reach.test.ts),
[`expressions.test.ts`](../../../packages/schema-system/expressions/src/expressions.test.ts)
(denied names), [`validation.test.ts`](../../../packages/schema-system/shared/tests/validation.test.ts),
render vector `render.node.ref-cycle`.
