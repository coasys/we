export interface CountMarkProps {
  /** The glyph, by Phosphor name. Drawn filled — it is a mark rather than an icon labelling a button. */
  icon: string;
  /** How many. Shown beside the mark, abbreviated past a thousand. */
  count?: number;
  /**
   * Whether this agent is one of the people the count is counting.
   *
   * The whole of the colour decision. A reaction is accented when it is yours; a conversation is
   * accented when you are in it. What it is NOT is "somebody did this" — a count of other people's
   * activity is information, and colouring it would make every busy row shout.
   */
  mine?: boolean;
  /**
   * How big it is drawn, on `we-button`'s own scale. Defaults to `md`.
   *
   * A mark is drawn at the weight of the thing it is about: on a post it is a control in its own
   * right, and in a thread it sits under a reply where anything larger is the loudest thing in the
   * conversation.
   */
  size?: 'xs' | 'sm' | 'md';
  /**
   * Whether the number follows the glyph's colour, or reads as ordinary text. Defaults to following.
   *
   * The two uses of this component want different answers, and one of them was wrong. As a COMPACT
   * display the mark and its number are one quiet thing to glance at, so the digits take the glyph's
   * colour — that is what the row-level colour below is for. As a toggle's control inside
   * `SignalControl` the number is the community's reading, which is the same role the vote's net
   * score and the rating's mean play, and both of those are plain text — so a dimmed count sat in a
   * row of undimmed ones and the like looked like a different kind of thing.
   */
  countTone?: 'glyph' | 'text';
  /**
   * Put the number before the glyph.
   *
   * A mark on a card reads left to right as "this thing, that many", which is why the count follows
   * by default. In a COLUMN of controls it reads down instead: a rating and a slider both lead with
   * their aggregate, so a toggle whose number sat on the other side put one figure out of line with
   * every other row — the one column a reader scans.
   */
  countFirst?: boolean;
  /** What pressing it does. Omit for a mark that only reports. */
  onPress?: () => void;
  /** What a screen reader is told the press does. */
  label?: string;
  disabled?: boolean;
  class?: string;
  styles?: Record<string, string | number>;
}
