## Observed differences

Written by hand from the side-by-sides at the commit that added this file. Re-check
them when the renderer moves; the table above is regenerated, this list is not.

### On every route

- **Black band under the app.** The Rust frame stops at about y=570 and leaves the
  rest of the 800px viewport transparent, drawn here on black. The web root fills the
  viewport (`min-height`). This band is most of the pixel score: about 32 on the light
  themes (`light`, `retro`) and 5–10 on the dark ones. Compare dark against dark before
  reading anything into a score.
- **A grey "AgentChatSheet · stage 5" bar across the top**, about 50px high, pushes the
  whole app down. The web app draws nothing there: the sheet is closed.
- **The left icon rail is missing**: the Coasys logo, the sparkle (AI) button, the space
  avatar "MC" with its selected state, `+`, the link button, settings at the bottom and
  the "PU" avatar. The Rust app starts at the space header.
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
- **"Start a call"** has the right fill but sits under the tree, about 460px from the top.
  On the web it is pinned to the bottom of the sidebar. The bottom of the sidebar
  (settings, avatar) is missing with the rail.

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
  below them. Involvement is cut off at the frame's bottom edge, beneath which the black band
  starts mid-content.
- **person**: the closest to the web in structure: the breadcrumb "People › Mara
  Ellison", the hero band, the "ME" avatar square, the name, the handle, the bio and the
  DID. The Rust avatar is teal on mint where the web is purple on lavender. On retro the
  web sets everything in monospace, Rust only the name and breadcrumb. The bio is larger
  in Rust. The "People" link in the breadcrumb is not underlined/boxed as on retro web.
- **about**: **the Rust render panics on every theme**: `No glyph for "→" (U+2192)
  in Proportional` from epaint. The installed fonts (Ubuntu-Light, phosphor,
  egui-icons) have no arrow, and the landing page's text carries seven of them. The
  web shows the coasys landing page (hero "We are building a global brain.", the two
  buttons, the globe video). In Rust there is no picture. The tree resolves (151 nodes),
  so this is a font-coverage bug in the painter, not a resolve failure.
