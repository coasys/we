# AD4M Bug: `removeLinks` fails with Apollo `__typename` fields

## Summary

`Ad4mModel.delete()` fails for models without a destructor (no `@Flag`, no `required` properties, no `initial` values) because `PerspectiveProxy.removeLinks()` passes link objects containing `__typename` fields back to a GraphQL mutation that rejects them.

## Reproduction

Any model with all-optional properties:

```typescript
@Model({ name: 'SimpleItem' })
class SimpleItem extends Ad4mModel {
  @Property({ through: 'ex://name' }) name: string = '';
}

const item = await SimpleItem.create(perspective, { name: 'test' });
await item.delete(); // ApolloError: Variable "$links" got invalid value — Unknown field "__typename"
```

## Root Cause

In `Ad4mModel.delete()` (`core/src/model/Ad4mModel.ts` ~line 1662):

1. `hasDestructor` evaluates to `false` when no property has `required`, `flag`, or `initial`
2. The non-destructor branch calls `perspective.get(new LinkQuery(...))` to fetch outgoing links
3. Apollo Client injects `__typename` into every returned object (standard cache normalization)
4. Those link objects are passed directly to `perspective.removeLinks(ownLinks)`
5. `removeLinks` sends them as a `$links` GraphQL mutation variable
6. The server's input type doesn't include `__typename`, so GraphQL validation rejects every element

The destructor branch (`removeSubject`) doesn't hit this because it uses SDNA destructor actions rather than `removeLinks`.

## Error

```
ApolloError: Variable "$links" got invalid value.
  In element #0: In field "__typename": Unknown field.
  In element #0: In field "data": In field "__typename": Unknown field.
  In element #0: In field "proof": In field "__typename": Unknown field.
```

## Correct Fix

In `PerspectiveProxy.removeLinks()` (or in the `Ad4mModel.delete()` non-destructor branch), strip `__typename` recursively from link objects before passing them to the mutation. Apollo provides a `removeTypenameFromVariables` link for this, or it can be done manually:

```typescript
function stripTypename(obj: any): any {
  if (Array.isArray(obj)) return obj.map(stripTypename);
  if (obj && typeof obj === 'object') {
    const { __typename, ...rest } = obj;
    return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, stripTypename(v)]));
  }
  return obj;
}
```

Apply in `PerspectiveProxy.removeLinks()` before the mutation call, or configure the Apollo client link chain with `removeTypenameFromVariables`.

## Workaround (current)

Add a `@Flag` or `required: true` property to the model so `hasDestructor` is `true` and delete uses `removeSubject` instead.

## Affected Code

- `core/src/model/Ad4mModel.ts` — `delete()` instance method, non-destructor branch (~line 1680-1700)
- `PerspectiveProxy.removeLinks()` — doesn't strip `__typename` from input
- Potentially affects `removeLinks` calls anywhere in the codebase, not just `Ad4mModel.delete()`
