# Policy

A space's **policy** is an allow-list of permissions, kept in the space as versioned `Policy` records: nothing is allowed that no permission allows, and there are no deny rules. The host judges every record write against the policy in force, at one point: the write check that `SpaceStore` registers with `@we/entities`.

**Why:** Allow and deny rules together need an order, and that order makes a rulebook hard to read; a mute or a ban is an `except` on the permission instead. The check is at the write path, not in a store or a template, so no caller can go around it. A template's `can()` only decides what to offer, because the write is judged again when it is made.

**Parent:** [Spaces](README.md)

<details><summary>How it works</summary>

1. Every entity has its actions: `<Entity>.create`, `.edit` and `.delete`, and `<Entity>.<relation>.add` and `.remove` (`actionOf`). A permission names one action, or a wildcard (`*.create`, `*.edit`, `*.delete`, `*.*.add`, `*.*.remove`, `*`).
2. A permission is `{ action, by, except?, when? }`. An `Actor` is `anyone`, `member`, `author` or `{ role }`. A `when` holds equality conditions on the record, and for an edit the fields it may change (`only` / `not`).
3. A permission that names an action exactly is the only kind that governs that action. A wildcard covers only the actions that the policy does not name.
4. Every write to a `Policy` record is `Policy.edit`, and handing out a role is `RoleGrant.create`. No wildcard matches an action on `Policy`, `Role` or `RoleGrant`. `validatePolicy` refuses a policy that names nobody who may edit it, unless it is `frozen`.
5. `evaluate(policy, request, who)` returns `null` or a `Refusal`: `not-permitted`, `condition`, `frozen`, `newer-format` or `unreadable`. `PolicyRefusal` is the error.
6. `policyInForce` walks the versions oldest first from `OPEN_POLICY`. A version counts only if the policy in force before it let its author do `Policy.edit`, with the roles held when it was written.
7. `createPolicyCheck` builds the check. A dataset that is not a space is not judged. Rules that cannot be read refuse with `unreadable`. The record is read only when the rule needs it (`needsRecord`).
8. `SpaceStore` registers it with `registerEntityWriteCheck`, shows a toast for each `PolicyRefusal`, and removes it on cleanup. `governedSpace` returns `null` for system datasets and keeps other spaces for 5 s.
9. Roles: `Role` and `RoleGrant` records. The creator writes the `admin` grant (`writeAdminGrant`) and the starting policy (`writeStartingPolicy`, the starter's `policy` preset) before the space is shared. A revoked grant is kept, so a version's author can still be judged by the roles held then.

| Preset | Rules |
|---|---|
| `open` (`OPEN_POLICY`) | every member may do anything; only admins change the rules and grant roles. A space with no policy reads as this. |
| `community` (`COMMUNITY_POLICY`) | members create and link; the author and admins edit; the author, moderators and admins delete; muted members are excepted |

</details>

<details><summary>Where in the code</summary>

- [packages/backend-system/shared/src/policy.ts](../../../packages/backend-system/shared/src/policy.ts): `Policy`, `Permission`, `Actor`, `Condition`, `evaluate`, `needsRecord`, `validatePolicy`, `readPolicy`, `Refusal`, `PolicyRefusal`, `POLICY_EDIT`.
- [packages/app-shell/src/shared/spacePolicy.ts](../../../packages/app-shell/src/shared/spacePolicy.ts): `OPEN_POLICY`, `COMMUNITY_POLICY`, `POLICY_PRESETS`, `policyInForce`, `createPolicyCheck`, `canFrom`.
- [packages/app-shell/src/shared/spaceRoles.ts](../../../packages/app-shell/src/shared/spaceRoles.ts): `ADMIN_ROLE`, `RoleRow`, `GrantRow`.
- [packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx): `governedSpace`, the registration, `writeAdminGrant`, `writeStartingPolicy`, `setPolicyPreset`.
- [docs/architecture/space-policy.md](../../../docs/architecture/space-policy.md) and [the decision](../../../docs/architecture/decisions/2026-10-25-a-space-policy-is-an-allow-list-judged-at-the-write.md): the long form.

</details>
