# Working notes are kept outside the repo

**Status:** Accepted — 2026-10-12

**Decision.** Plans, research, conversation notes and drafts written for GitHub — PR descriptions,
issue bodies, review replies — are not kept in this repository. Each contributor keeps them wherever
they keep notes. What stays here is what describes the system: architecture docs, package docs, and
these decision records.

**Why.** `docs/internal/` held 50 such documents. Its own convention was that every plan carried a
dated status line; 34 of 41 plans and decisions had none, and several of those that did said
"superseded". A plan in the repo reads as a description of the code, so a stale one misleads anyone —
or any agent — that finds it. Working notes change at the pace of the work; the repo should not have to
review them. The decisions worth keeping moved here; the rest went to the maintainers' own notes.

**Rejected.**

- _Keep `docs/internal/` and enforce the status line._ That was already the rule and it did not hold:
  nothing fails when a plan goes stale, so they do.
- _Draft PR descriptions as `PR_*.md` at the repo root, gitignored._ The ignore rule only ever covered
  that one filename, and the convention existed only so the rule had something to catch. A sentence in
  `docs/contributing/pull-requests.md` — never commit a draft written for GitHub — covers every name.

**Revisit when.** The team wants shared, reviewed planning documents. Those would want a home with an
owner and a review step (an issue, a discussion, a planning repo), not a folder of drafts here.
