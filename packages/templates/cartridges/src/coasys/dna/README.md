# Coasys Social DNA

The classes and flows installed by hand into the Coasys spaces, so that calls there are interpreted into
topics, positions, open questions and action items. They are here to be reviewed. Nothing in WE reads
these files yet: no seed, bundle or store imports them.

## Classes

Each file is a SHACL shape in the JSON form `add_model` takes. Every class and property carries an
`interpretation_hint`, the instruction the interpretation model follows when it extracts from a
transcript.

| File                   | Class                    | What it is                                                                                       |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `DiscussionTopic.json` | `conv://DiscussionTopic` | One thread of discussion: `title`, `summary`, and `clarity` (low, medium or high)                |
| `Position.json`        | `conv://Position`        | A view one person states on a topic: `statement`, `holder`, `stance` and the topic it is `about` |
| `Question.json`        | `conv://Question`        | A question the group leaves open: `text`, `askedBy` and the topic it is `about`                  |
| `ActionItem.json`      | `delivery://ActionItem`  | Work a named person will do after the call: `title`, `owner` and the topic it came out of        |

The topic class is `DiscussionTopic` and not `Topic` because the executor matches an installed class by
its name: a class named `Topic` would replace WE's own `we://Topic`.

## Flows

`flows.json` holds the 87 links that define two flows, written with `add_link`. Literal targets are in
the single-colon form, `literal:string:<url-encoded text>` and `literal:number:<n>`.

**ConversationTopic** follows a `DiscussionTopic` through a conversation:

| State        | Value | Means                                                                   |
| ------------ | ----- | ----------------------------------------------------------------------- |
| `raised`     | 0     | Only one person has spoken about it so far                              |
| `parked`     | 0.25  | The group explicitly defers it                                          |
| `discussing` | 0.5   | Two or more people engage and views differ, or the key question is open |
| `resonant`   | 1     | The people engaging agree on the substance, or settle on a decision     |

Transitions: Engage (raised → discussing), Agree (raised → resonant, discussing → resonant), Park
(raised → parked, discussing → parked), Resume (parked → discussing).

**Delivery** follows an `ActionItem` to done:

| State        | Value | Means                                 |
| ------------ | ----- | ------------------------------------- |
| `identified` | 0     | Someone named work that should happen |
| `committed`  | 0.3   | A named person said they will do it   |
| `done`       | 1     | Someone reports it finished           |

Transitions: Commit (identified → committed), Finish (committed → done).

The flows have no guards. The run these were tested with carried none, so none were installed.

## How it was installed

1. `add_model` once per class, with the file's contents as the shape and the class name as the file name.
2. `add_link` for every link in `flows.json`, in file order. Each flow's two registration links
   (`ad4m://self` `ad4m://has_flow` its name, and the name's `ad4m://flow_uri`) come after its states and
   transitions, so the flow is complete before it is found.

Installed into the Coasys, CoAtlys and Coasys internal spaces on 10 and 11 November 2026.
