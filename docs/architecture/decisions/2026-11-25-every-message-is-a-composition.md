# Every message is a composition

**Status:** Accepted

**Decision.** Every line of conversation is a composition, like a post. That covers a typed message, a bot's message, a reply, and a line spoken in a call. Each is a `CollectionBlock` (kind `message`, or `reply` in a thread) holding its blocks. When the line has no more than its words, it still holds them in one text block. Files attached to it sit in one group among its parts (kind `attachments`). Its words are `textContent`, and how it arrived is `source`. It keeps no stored `editorState`: a line is drawn from its parts (`@we/messages`).

**Why.**

- **A line keeps its id.** Adding a file, a paragraph or an image later adds a child. The line keeps its id, so a reply, a reaction, a drag, or an interpretation's provenance never points at something that changed shape.
- **One shape for every template.** A template built later reads and draws a line the same way it reads a post or a document, without knowing where the line came from. That is what the block system is for.
- **One containment link.** A file in a message is a child under `we://child`, like every other part. There is no second relation beside it.
- **The group is a thing of its own.** A set of files can be drawn, commented on or reused as one, and each file is still a record of its own.

**The cost.** It was measured at 5,000 lines in a call: reads take 1.7 to 1.9 times as long as bare lines, and writes about twice as long, a few milliseconds a line. The measurement found an executor read that slowed with the size of the class, and that fix made bare reads faster too. No stored copy is kept, because it would mean one file upload per spoken line.

**Rejected.**

- **A bare `TextBlock` per line, with files as its children.** It is the cheapest option. But the first attachment adds a second kind of containment to a text block, and a template drawing posts and one drawing chat would read two shapes.
- **A wrapper only when a line has more than words.** This makes the id problem worse: the line's record changes when its first file arrives.
- **Utterances as bare text, on the grounds that a transcript is not edited.** Somebody reading a transcript back will want to attach to what was said, and an exception for one kind of line is the inconsistency this decision removes.

A bare `TextBlock` in a conversation is still drawn, as a one-part line. A writer that knows nothing of messages can still write one: a bot through its own tools, or an older client. Readers tolerate it, and every writer WE controls writes compositions.

**Revisit when.** A backend can't read nested untyped includes in one query (the `queries.transcript-lines-with-parts` conformance case), or lines grow past what the window reads can bound. That second limit is already near: a newest-N page grows with a call's history whatever a line is.
