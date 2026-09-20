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
  /** What pressing it does. Omit for a mark that only reports. */
  onPress?: () => void;
  /** What a screen reader is told the press does. */
  label?: string;
  disabled?: boolean;
  class?: string;
  styles?: Record<string, string | number>;
}
