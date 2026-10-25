# A space's policy is an allow-list held in the space, and judged where every write passes

**Status:** Accepted — 2026-10-25

**Decision.** Who may do what in a space is a **policy**: a list of permissions held in the space as
versioned `Policy` records, with nothing allowed that no permission allows. Every write is judged by
it at one point, the write check in `@we/entities`, which every backend asks from its own write path.
Templates can ask (`can()`) but never decide. The policy governs its own changes through an ordinary
permission, `Policy.edit`, and each version is judged by the one before it, as of the roles held when
it was written. See [space-policy.md](../space-policy.md).

**Why.**

- **The space, not the template.** A template is a view any member with edit rights can change, and a
  space can switch template. Rules kept there would protect nothing and would vanish with it.
- **The write, not the caller.** Writes reach a backend from stores, template record actions, modules
  and relation accessors on an instance. A check in any one of those leaves the rest open. A check
  every backend asks before writing cannot be gone round from above.
- **An allow-list.** It reads top to bottom as what is possible, and a new kind of record is only as
  open as a policy says.
- **Self-governance through ordinary permissions.** No second amendment mechanism to learn or to
  secure.
- **Judged as of then.** Without it, an admin stepping down would take every version they wrote with
  them, and a role granted today would bring back versions written before it.

**Rejected.**

- _Deny rules beside allows._ They need an order between them, and "which one wins" is where policy
  systems stop being readable. A mute or a ban is an `except` on the permission that would reach them.
- _The more specific permission wins._ The same problem in another form. Instead, an action named
  exactly is governed only by the permissions naming it, and a wildcard covers only what is not named.
  Every permission still only allows.
- _Checks in stores, or in the template._ Each caller would have to remember, and one that forgot
  would be a way round every rule.
- _Revoking a role by deleting the grant._ The history the policy is judged by would go with it.
- _Editing the policy record in place._ Concurrent edits would overwrite each other, and the chain of
  who allowed whom would be lost.

**Revisit when.** A backend can judge writes itself — refusing them, or counting only permitted ones
when reading. The host's check then becomes what that backend's own enforcement backs up, and
`can()` keeps using the same evaluator.
