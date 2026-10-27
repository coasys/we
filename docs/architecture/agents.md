# Agents

What a language model can do with WE, and where each rule it works under lives. The tools are in
`packages/agent-tools/`, and its README is the reference for a host that offers them. This page is
the reasoning: which rules are WE's, where what an agent makes ends up, and who holds the
conversation.

## Two kinds of rule

An agent working in a space needs two kinds of rule, and they belong in different places.

**The data side** is the backend's: reading the graph, making and changing records, defining record
types, who may do what, and running the model. These are the same for any app the backend serves,
and a backend that provides them provides them better than a copy here could, since it holds the
data and the policy.

**WE's formats and conventions** are WE's: whether a template is valid, what a theme setting means,
and how WE links records to one another (a reply is a response in its subject's thread, never a
child; a collection's children are in the order somebody arranged them). To the backend a template
is a file and a reply is two links. Only WE can say whether the file renders or the links mean what
the person asked for, and the answer changes with every WE release.

So WE ships its formats and conventions as **toolsets** in `@we/agent-tools`, and they run wherever
the agent runs: inside a backend that hosts WE's bundle, or in WE's own conversation. The test for
anything new: _does an agent need WE's rules to know the result is correct?_ If it does, it is a WE
toolset. If any app on the backend would need it the same way, it is the backend's.

## A toolset holds nothing

Every call is given the record as it is stored now, and answers from that alone: text for the model,
and the properties to write. A host needs no session, two agents can use the same tools at once, and
the encoding of a record (which fields, how a file property is written) never leaves WE. A failed call
answers with text starting `Error: ` rather than throwing, since the model reads it and fixes its
next call. An update names the `version` it was written against, and a record that has moved on since
is refused rather than edited blind.

A tool that **creates** works the same way with no record to edit, or with one to start from (a
template to fork). It declares the entity it makes and the places one may go, and its answer names
the place the call chose. The host makes the record there.

## Where a new template or theme goes

Templates, themes and apps belong to the person ([apps-as-data.md](apps-as-data.md)), and what an
agent makes for them does too:

- **The person's library by default.** "Make me a dark theme" is theirs.
- **The space only when the request says so** ("for this space"), and only where the person may
  make that change there. The write check judges it as it would the person's own.
- **An app is always the person's.** It is the chrome around every space they open, never one
  space's.

Which dataset "library" and "space" are is the host's to know, so a tool names the place in WE's
words and leaves the rest to whoever makes the record.

A record in the right place is all it takes to be seen. A library template is listed unless the
person hid it, rather than only once something also added it to a list of what to show: a list of
that kind leaves out everything written from somewhere other than the screen that keeps it.

## One conversation, run in one place

A request runs entirely on one side. Either the backend runs the agent — WE sends the conversation
through the `agents` port and reads the answer, and the backend's tools and WE's bundle do the work —
or WE runs it, calling the model one turn at a time through `LanguageModelPort.converse` with WE's
toolsets. Never some tools on each side within one request: the model would see two sets of names
and two descriptions of the same graph, and nobody reading the outcome could say which rules applied.

Which side is decided by what the backend provides. A backend that runs agents provides the `agents`
port; one built before it could answers `AgentUnavailableError`, and the request falls back to WE's
own conversation. The same choice is what lets a backend that runs no agents at all still offer them.

### Help only the client can give

Some of what an agent could use exists only where the person is: what they have selected, what is on
screen, an unsaved working copy, a preview they can look at before anything is saved, a question
answered before a delete. These are **session tools**, offered by the client into the conversation
whichever side runs it. They have no counterpart on the backend, so they do not break the rule above.
They need the backend's agent to be able to pause and ask the client, which it cannot yet.

## Writes and policy

Every write an agent makes goes out as the person, with the person's permissions, so letting an agent
write adds no authority: it only stops narrowing what the agent may do. In WE's own conversation the
write goes through the same write path as any other, so the space's policy judges it
([space-policy.md](space-policy.md)). An agent the backend runs writes through the backend's own path,
so policy has to be enforced there too before such an agent is given records to write.
