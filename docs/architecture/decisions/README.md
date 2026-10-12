# Decisions

The choices every later change has to respect, one file each. A record says what was decided, why,
what lost, and what would make it worth reopening — so the next person to propose the alternative
finds the argument already made, instead of making it again.

Architecture docs describe how the system works; a record says why it is not some other way. Reasoning
local to one package stays where it is: that package's README, its `CONVENTIONS.md`, and its comments.

## When a decision gets a record

All three:

1. **It constrains more than one package**, or the shape of the whole system.
2. **It rejected a tempting alternative** — one somebody would reasonably propose again. If nobody would
   suggest the opposite, it is a description, not a decision.
3. **The reasoning is not visible from the code.** The code says what; a record says why not.

Most PRs make no such decision. A few a month is the expected rate; many more means the bar has
slipped. A PR that does make one adds the record in the same PR — the template's "Docs kept in sync"
list asks.

## Format

`YYYY-MM-DD-slug.md`, dated the day it was decided. Short — most fit on one screen — and linking to
the doc or code that carries the detail rather than repeating it:

```markdown
# <the decision, as a statement>

**Status:** Accepted | Superseded by [<record>](file) — <date>

**Decision.** One or two sentences.

**Why.** The reasoning.

**Rejected.** Each alternative, and why it lost.

**Revisit when.** What would make this worth reopening.
```

A decision that is overturned keeps its file: change its status to name the record that replaced it,
so the history reads in order.

The four records dated before 2026-10 predate this format; they are longer, and kept as they were
written, with a status note where the code has moved on.
