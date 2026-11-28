# Handler tokens

A **handler token** is a prop value that becomes a function the element calls on an event. `$invoke` calls a store method. `$setLocal`, `$toggleLocal`, `$toggleLocalIn`, `$callLocal`, `$touch` and `$resetLocal` write the node's **local state**. `$if` chooses between handlers when the event fires.

**Why:** A method gets exactly the `args` the template writes, and no arguments when there are none. The element's event reaches the method only through an expression such as `{ $: 'event.detail' }`, so a store method does not depend on the event detail of each element that calls it (`invoke.ts`). The `$if` handler reads its condition when it fires, so it can test the event and the store state at that moment (`conditional.ts`).

**Parent:** [Schema language](README.md)

<details><summary>How it works</summary>

**`$invoke`.** `{ $invoke: 'store.path.method', args, onSuccess, onError, onFinally }`.

1. The last path segment is the method. The segments before it are the path to the object that holds it, so `modules.notes.toggle` works.
2. `args` resolve at render time. An argument that names `event`, `arg` or `result` waits for the call ([Expressions](expressions.md)). Each argument is unwrapped to a plain value at call time.
3. A call to `routeStore.navigate` gets the base depth of the route the node renders in, so a relative path resolves against that route.
4. If the method returns a promise, `onSuccess` or `onError` runs with `result` bound to the value or the error. Then `onFinally` runs.

**Gestures.** In the template bag, an action that is not marked `ambient` runs only during a person's gesture: a press, a key, typing, a drop or a paste (`gesture.ts`). The renderer gives each node with a handler a gesture credit for a trusted press on its path. A later call from that node can use the credit once, within `CREDIT_MS` (30 seconds). `onSuccess`, `onError` and `onFinally` run under the gesture of the call.

**Local state.** `$localState` declares fields on a node. Each field has a `type` and an `initial` value, and optionally `validate`, `persist` and `syncParam`. An expression reads a field as `local.<name>`.

- `persist: '<key>'` stores the field on the device, for a preference.
- `syncParam` mirrors the field into a URL query parameter, for view state. On mount the URL parameter wins, then the stored value, then `initial`.
- `$setLocal` sets a field (`value`) or merges into an object field (`merge`). `$toggleLocal` flips a boolean. `$toggleLocalIn` adds a value to an `array` field or removes it. `$callLocal` calls a `function` field. `$touch` marks a field as touched for validation. `$resetLocal` resets the fields of the scope.
- Fields from `$queries` are read-only ([Template queries](../renderer/queries.md)).

</details>

<details><summary>Where in the code</summary>

- [propResolvers/invoke.ts](../../../packages/schema-system/shared/src/propResolvers/invoke.ts): `resolveInvokeProp`.
- [propResolvers/local.ts](../../../packages/schema-system/shared/src/propResolvers/local.ts): `resolveSetLocalProp`, `resolveToggleLocalProp`, `resolveToggleLocalInProp`, `resolveCallLocalProp`, `resolveTouchProp`, `resolveResetLocalProp`, `setLocalWarningSink`.
- [propResolvers/conditional.ts](../../../packages/schema-system/shared/src/propResolvers/conditional.ts): `resolveIfHandler`.
- [gesture.ts](../../../packages/schema-system/shared/src/gesture.ts): `installGestureTracking`, `registerGestureOwner`, `hasGesture`, `captureGesture`, `runWithGesture`, `CREDIT_MS`.
- [types.ts](../../../packages/schema-system/shared/src/types.ts): `LocalStateField`, `RouteParamsBinding`.
- [docs/architecture/routing-and-view-state.md](../../../docs/architecture/routing-and-view-state.md): which state goes in the address, in a preference or in local state.

</details>
