# Space policy

A space's **policy** says who may do what to its records. It is held in the space, so it survives a
template switch, a fork and an export, and every write anybody makes in the space is judged by it at
the one point every write passes.

The format and the evaluator are in `packages/backend-system/shared/src/policy.ts`. What the host adds
(presets, the version in force, the write check) is in `packages/app-shell/src/shared/spacePolicy.ts`.

## What a policy says

A policy is a list of **permissions**, and nothing is allowed that no permission allows:

```json
{
  "format": 1,
  "permissions": [
    { "action": "*.create", "by": ["member"], "except": [{ "role": "muted" }] },
    { "action": "*.delete", "by": ["author", { "role": "moderator" }, { "role": "admin" }] },
    { "action": "TaskBlock.edit", "by": ["member"], "when": { "change": { "only": ["status"] } } },
    { "action": "Policy.edit", "by": [{ "role": "admin" }] }
  ]
}
```

- **Actions** come from the entities, with nothing declared by hand: `<Entity>.create`, `.edit` and
  `.delete`, and `<Entity>.<relation>.add` and `.remove` for each relation.
- **Wildcards** (`*.create`, `*.edit`, `*.delete`, `*.*.add`, `*.*.remove`, and `*` for all of them)
  cover what the policy does not name. **An action named exactly is governed by the permissions naming
  it alone**: once `TaskBlock.edit` appears, `*.edit` says nothing about tasks. This is scope, not
  precedence. Every permission still only ever allows.
- **Actors** are `anyone`, `member`, `author` (whoever made the record acted on), or `{ role }` by its
  slug. `except` takes actors out of a permission that would otherwise reach them, which is how a
  mute or a ban is written without a deny rule.
- **`when`** narrows a permission to some records (`record`: fields and the values they must hold,
  before and after an edit) or to edits touching some fields (`change.only`, `change.not`).

There are no deny rules. Allow and deny together need an order between them, and that order is where a
rulebook stops being readable.

## The policy governs itself

Changing the policy is the action `Policy.edit`, and handing out roles is `RoleGrant.create`. These
are ordinary permissions, and **no wildcard reaches them, or anything else on `Policy`, `Role` or
`RoleGrant`**. A line opening "everything" to members must not hand them the rules as well.

`validatePolicy` refuses a policy nobody could ever edit again unless it says `frozen: true`, and
`policyWarnings` points out a policy that keeps its own editing to a role more people may hand out.

## Where it is stored

Each version is a `Policy` record holding the whole document. Changing the rules writes a new
version. The one in force is worked out by `policyInForce`:

- The walk starts from the `open` preset, which is what a space with no versions reads as.
- Each version, oldest first, counts only if **the version in force when it was written** allowed its
  author `Policy.edit`. A version is never judged by itself, so none can approve itself.
- Each is judged by **the roles held when it was written**. A version an admin wrote stays in force
  after they step down, and granting somebody a role does not bring back a version they wrote before
  they held it. That is why revoking a role marks the grant (`RoleGrant.revokedAt`) rather than
  deleting it: the history is what the judgement reads.
- A version that does not parse is skipped. Within one, a permission that does not parse is dropped,
  which can only ever allow less.

A policy carries a `format`. One written in a newer format than this code reads refuses every write
in the space, with a message asking the person to update, rather than being guessed at.

## Where it is enforced

`@we/entities` holds one **write check**, which the host registers (`registerEntityWriteCheck`). Every
backend asks it from its own write path before a create, an edit, a delete, or a relation add or
remove. A refused write rejects with a `PolicyRefusal` and writes nothing.

- **The backends.** The in-memory backend asks in each write method. The production adapter installs
  the check on its model base class (`backend-ad4m/src/writeChecks.ts`), so every model class,
  including ones a space defines later, inherits it. The writes a create makes for itself (its named
  relations, its parent link) and the relation writes inside a save are part of that create or save,
  not writes of their own. The conformance case `writes.checked-first` refuses each kind of write on
  every backend.
- **The host.** The space store registers the check (`createPolicyCheck`). It judges writes to any
  space this agent has open, and nothing else: the agent's own datasets are not spaces. It reads the
  record acted on only when the permission needs it, for an author to compare or a field to hold. A
  refusal is shown in a toast as well as rejected, so a store that swallows its own errors still tells
  the person why nothing happened.
- **Templates.** `spaceStore.policy` is the policy in force, with each permission as a sentence.
  `can({ policy: spaceStore.policy, action, record })` lets a template decide what to offer. It is a
  convenience only: the write is judged again when it is made.

## Presets

| Preset      | What it allows                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `open`      | Everybody who has joined may do anything. Only admins change the policy or the roles. What a space with no policy reads as, so a space made before policies existed behaves as it did.                                                                                               |
| `community` | Members make things, and authors edit and delete their own. Anybody may move a card between columns or place something on the canvas. Moderators and admins delete anything. The space's settings, its vocabulary and its landmarks are admins'. The `muted` role takes away making. |

A new space starts open: nothing is written unless its starter's `policy` names a preset, and then
the creator writes it at the create press, after their admin grant and before the space is shared. A
joiner never writes one. Two first versions would compete, and an unsynced joiner cannot tell whether
one already exists. Admins choose `community` in People.

`community` is not the default yet because some shared work is edited by members who did not make
it, and `community` keeps editing to a record's author and the space's admins. A call's extraction
switch, a transcript line from another participant's device, a suggested change to somebody else's
record, and a board's columns are each refused to such a member there. Which of those count as shared
work any member may edit, as a task card's state and the canvas already do, is the decision before it
becomes the default.

**A new entity** a module adds is covered by the wildcards in both presets. A community that wants it
closed names its actions.

## What it does not do yet

- **Reads are not governed.** Everything in a space is visible to everybody in it.
- **Approvals and evidence** belong to workflows (see [workflows.md](./workflows.md)), not to
  permissions. A permission that needs several people to agree, or a record to exist first, is later.
  So is a workflow transition as an action the policy names.
- **Membership is open.** Everybody who has joined is a member, and joining is by link. A permission
  to join comes first after this.
- **Judged by the writer's own app.** The check runs in the app making the write, so it holds where
  every member uses a version of WE that has it. A write made by other software straight to the
  space's data, or by a version from before policies, is not judged. Counting only permitted writes
  when reading is the next step for the production adapter.
- **One person, one key, wherever a backend cannot tell them apart.** Persons are resolved through
  `PersonPort`. `can()` compares a record's author with the viewer directly, which is exact wherever a
  person is one key.
