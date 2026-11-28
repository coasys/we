# Feed

The feed module (`@we/module-feed`) shows everything said and written in a space as one stream: the lines of each call, messages typed outside a call, replies and bot messages, sorted by time, with a row for what interpretation found. `@we/messages` is the library that the feed and the transcript both use to draw one message line.

**Why:** A module may not depend on another module, so what the transcript and the feed share is a library that both import at build time, and not a capability (`messages/src/index.ts` header). The feed reads calls one at a time and merges them, because one sorted query over all messages reads every message on each page: the store has no top-N and no index on time (`feed.ts` header).

**Parent:** [Bundled modules](README.md)

<details><summary>How it works</summary>

**One page of the feed** (`readFeedWindow`): the space's calls in time order, the newest page of each call that can reach into the window, and the messages outside calls, merged by time. From the live end, a call can still be in progress, so the read uses `MAX_CALL_SPAN_MS` (12 hours) as the longest call. Interpretation results are activity rows, one for each conversation and pass ("3 tasks and 1 event, from …"). Records that nobody extracted are grouped by author.

**Bot notices** (`botWatch.ts`). A line that a bot writes in the space on screen raises a notice with a way to open the feed, unless the reader looks at the newest line. A bot is an agent whose profile says so (`ModuleIdentity.kind`). Lines from one author within `BOT_BURST_MS` (2 s) are one notice.

**Placements:**
- The `feed` panel (order 92, right edge).
- The part `feedView`, a page of the feed.
- The part `callFeed`, the feed of one call. Its subject is `routeStore.params.call` by default.

Both parts use `whileShown`, so the feed reads only while it is on screen.

**Settings:** `timelineOrder` and `botNotices` (agent level), and `showCallTranscripts` (agent-in-space, default false), because spoken lines can hide typed messages in a space with many calls.

**`@we/messages`:**
- `SPOKEN`, `TYPED`, `CORRECTED`: the `source` of a line. `sourceAfterEdit` makes an edited spoken line `corrected`. A bot's line has no source.
- `threadLines`: a page of lines with each line's `thread` put in beside it, and each reply with a quote of what it answers, sorted by time. It is also the expression function `threadLines` (`threadLinesFunction`).
- `repliesInclude`: the `include: { thread: true }` that brings the replies.
- `lineContent`: the blocks of a line's text, with marks and links.
- `messageLine`: the schema fragment for one line.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/feed/src/index.ts](../../../packages/module-system/feed/src/index.ts): `feedModule`, its parts, panel and settings.
- [packages/module-system/feed/src/feed.ts](../../../packages/module-system/feed/src/feed.ts): `readFeedWindow`, `MAX_CALL_SPAN_MS`, the activity rows.
- [packages/module-system/feed/src/feedStore.ts](../../../packages/module-system/feed/src/feedStore.ts), [store.ts](../../../packages/module-system/feed/src/store.ts): the store.
- [packages/module-system/feed/src/botWatch.ts](../../../packages/module-system/feed/src/botWatch.ts): bot notices.
- [packages/module-system/messages/src/](../../../packages/module-system/messages/src): `source.ts`, `thread.ts`, `messageLine.ts`.

</details>
