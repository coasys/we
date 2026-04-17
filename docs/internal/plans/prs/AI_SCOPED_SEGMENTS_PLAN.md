# AI Scoped Segment Editing (Future Optimization)

## Overview

Reduce input tokens by sending only the relevant segment of a template to Claude instead of the full tree. Use the existing section indexer to scope edits and provide a skeleton of the rest for path context.

**Prerequisite**: AI Tool Architecture (tool_use + prompt caching) must be in place first.

---

## Problem

Currently `buildClaudeMessages()` embeds the full `templateStore.currentTemplate` in every user message. For small templates (2-5K tokens) this is fine. As templates grow to 10K+ tokens, this becomes a significant cost — and unlike the system prompt, user messages **are not cached**.

---

## Proposed Approach

### Input Format

Replace the flat `currentSchema` with a scoped view:

```json
{
  "request": "change the header background to primary-500",
  "editingSegment": {
    "path": [0],
    "node": { "type": "Row", "props": { "bg": "neutral-100", "p": "400" }, "children": [...] }
  },
  "templateSkeleton": {
    "type": "Column",
    "children": [
      "← editing this segment (path [0])",
      { "type": "Row", "childCount": 3, "summary": "main content area" },
      { "type": "Column", "childCount": 5, "summary": "footer section" }
    ]
  }
}
```

### Segment Selection

Use the existing section indexer (`packages/schema-system/shared/src/indexer.ts`) to identify landmark sections (navigation, routes, panels, large subtrees). Map the user's request to the most relevant segment:

- Simple heuristic: if the user mentions "header", "nav", "sidebar", "footer" — select that section
- Default: send the full template (fallback for ambiguous requests)

### Output

No change — `update_schema` patches already use paths relative to root. The segment is spliced back in using the same `patchByPath` mechanism.

---

## When to Implement

When templates regularly exceed ~8K tokens. Current templates are 2-5K — the system prompt (25K cached) dominates cost, not the template payload. This optimization saves meaningful tokens only when template JSON is a significant fraction of the total request.

---

## Complexity

Medium. Requires:

- Segment selection logic (mapping user intent → section)
- Skeleton generation (strip props/children, keep type + childCount)
- System prompt updates to explain the scoped format
- Fallback to full template when segment can't be determined

Not needed now — full template approach is correct for current template sizes.
