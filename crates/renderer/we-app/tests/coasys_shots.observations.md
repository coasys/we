## Observed differences

Written by hand from the side-by-sides at the commit that added this file. Re-check
them when the renderer moves; the table above is regenerated, this list is not.

### On every route

- **The left icon rail is present** (Coasys logo, sparkle/AI button, space avatar
  "MC", `+`, link, settings gear, "PU" avatar at the bottom) since the abs-percent
  containing-block fix; it is narrower than the web's 72px + tree band and its icons
  sit slightly differently.
- **The "MC" rail avatar uses the wrong colours**: pink/red initials in Rust where
  the web draws olive-green with dark initials (light) or dark-green with
  yellow-green initials (dark themes).
- **The tree panel is narrower and not as tall.** It is about 210px wide, against 220px of
  tree inside 280px on the web. Rows are shorter (19px against 28px), the text is about
  2px smaller, and the space "SPACE" heading and its rows are indented differently.
  Disclosure carets are small filled triangles (▾/▸) where the web draws thin chevrons.
  Count badges sit right after the label instead of right-aligned in a column. The
  "Calls" and "Workflows" `+`/caret controls follow suit.
- **Search box**: the web draws a 40px rounded field with the magnifier on the left; Rust
  draws a flat 16px strip with the magnifier in the middle and the placeholder
  left-aligned in a smaller font.
- **The "MC" avatar uses the wrong colours**: pink with red initials in Rust, where the
  web draws olive-green with dark initials (light) or dark-green with yellow-green
  initials (dark themes). The header's description wraps over three lines ("A /
  neighbou…") in both.
- **Selected tree row**: Rust fills the row with a saturated cyan/blue
  (`accent`-like, from egui's selection colour?) under every theme. The web uses a soft
  accent tint (lavender on light/dark, teal-ish on glow) and keeps the text colour.
- **The main area stops at about x=1350** (in 2560px). A second panel border and an
  empty strip run to the right edge. The web's main area fills the width.
- **Fonts**: Rust draws the theme's face where it has one (retro's monospace headings
  show), but body text stays in egui's proportional face, while retro and cyberpunk use
  monospace throughout on the web. Text is generally lighter and smaller.
- **Glow and cyberpunk backgrounds**: the web's glow page has a purple-to-blue
  gradient (`surfaceImages`); Rust paints the flat surface colour. Cyberpunk's clipped
  card corners and the overline "SPACE" label are absent.
- **"Start a call"** is now pinned to the bottom of the sidebar as on the web
  (the rail and bottom controls exist now); its width differs slightly.

### Per route

- **index**: the web landing redirects into the Design channel (breadcrumb
  "Channels › Design", six messages, composer). Rust stays on the Feed: heading "Feed"
  and a red **unknown `$part` box** where `feed.feedView` should be. No messages, no
  composer.
- **workflows**: the content matches: the "Workflows" heading, the Pilot 3 and Review 2
  rows, "Choose a workflow…". The list column is narrower and the counts follow the
  name instead of being right-aligned. The Workflows row in the tree is selected in
  saturated cyan.
- **channels**: all four channels are there, but in a two-column grid that overlaps.
  "General"'s and "Design"'s second lines are hidden under "Field notes" and
  "Announcements". "Announcements" is cut to "Announceme…". The web uses three columns
  with room to spare. Light: the cards have no fill on either side. Cyberpunk: the web's
  cards have clipped corners, the Rust cards are plain and overlap.
- **channel-design**: the breadcrumb and Page/Canvas toggle match. In place of the six
  messages, a red **unknown `$part`** box (`transcribe.transcriptFeed`, the messages)
  and a grey **"BlockComposer · E8"** placeholder for the composer, with the send
  button beside it.
- **calls**: three call cards, but in an overlapping two-column grid. "Weekly sync"'s
  date is hidden under "Pilot kickoff", which is cut to "Pilot …", and the cards are
  narrower than the web's three columns of 220px.
- **call**: the breadcrumb is cut to "Weekly …" with a red **unknown `$part`**
  (`call.renameCallButton`) where the pencil is. "This call has ended…" and "Pick it back
  up" match (the green fill is right on glow). The transcript is a red **unknown
  `$part`** (`transcribe.transcriptFeed`): none of the six transcript lines show.
- **people**: all seven people are there, but cards overlap in two columns. Mara
  Ellison's and Juni Okafor's handles are covered, and Rust's cards are offset unevenly.
  Avatar colours differ: Rust uses darker fills with coloured initials, and the web
  uses tinted fills.
- **dna**: the closest route (pixel ≈ 5–7). Signal types, Connection types, Task states
  and Involvement are all present with the right counts and icons. The grid is two
  columns where the web has three. Each section's last odd card wraps alone. "relates
  to" is drawn as a white card that spills **left over the tree panel's edge**.
  "Agree"'s description "Same page." and "blocks"' description are overdrawn by the card
  below them. Involvement now reaches the viewport's bottom edge like the web.
- **person**: the closest to the web in structure: the breadcrumb "People › Mara
  Ellison", the hero band, the "ME" avatar square, the name, the handle, the bio and the
  DID. The Rust avatar is teal on mint where the web is purple on lavender. On retro the
  web sets everything in monospace, Rust only the name and breadcrumb. The bio is larger
  in Rust. The "People" link in the breadcrumb is not underlined/boxed as on retro web.
- **about**: renders on every theme now (the vendored Noto symbol fallbacks cover
  the `→`s; anything still missing draws as tofu rather than panicking). The hero
  heading, body copy, both buttons and the "Coasys film" tile all draw, but the
  layout is wrong: the header row (logo, nav links, GitHub badge) overlaps the
  centered "We are building a global brain." title, the globe image/video is a
  flat card, and light/retro score ~70 because the page paints its own dark
  surface while the Rust side uses the theme's light page colour.
