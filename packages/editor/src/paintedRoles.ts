/**
 * Which roles paint the selected node — including the ones it does not set itself.
 *
 * "What colour is this?" is the first question anybody asks of an element they do not like, and
 * until now the panel could only answer it for a node that names a colour in its own props. That is
 * the minority: text almost never sets `color`, it inherits one from a Column three levels up, so
 * the field reads "—" for exactly the element somebody clicked *because* its colour was wrong.
 *
 * So walk up. A background comes from the nearest ancestor that paints one; a text colour from the
 * nearest that sets one. Reporting where it came from matters as much as reporting what it is —
 * "inherited from Column" is the difference between editing this node and editing the right one.
 *
 * Only the schema is consulted, never the rendered DOM: a computed colour is an rgb triple, and the
 * whole question here is which *name* is responsible for it.
 */
export interface PaintedRole {
  /** The prop this answers for — 'Background', 'Text', 'Border'. */
  what: string;
  /** The role or scale position responsible. */
  value: string;
  /** The node type it was set on, when that is not the selected node itself. */
  from?: string;
  /**
   * Nothing in the template sets this — it comes from the document's own stylesheet.
   *
   * Only ever true of the text colour, and it is the *common* case for text: `index.scss` sets
   * `body { color: var(--we-role-text) }`, and most text in the app says nothing about its colour
   * and inherits from there. Reported rather than omitted, because "no node sets one" was
   * indistinguishable from "this element has no text colour" — so selecting a `we-text` that had not
   * been given a colour showed a background and no foreground at all, which is the one thing you
   * were looking for and the one thing missing.
   *
   * A caveat this cannot see: a component between the node and the document may paint its own colour
   * in its shadow root — a `ghost` button does — in which case the document's role is not what
   * lands. The readout only ever consults the schema, so it says where the *template* leaves it.
   */
  fromDocument?: boolean;
}

/**
 * What the document paints text with when no node says otherwise — `index.scss`'s `body` rule.
 *
 * A constant here rather than a lookup, because the readout has no stylesheet to consult and the
 * rule is one line that has not moved since the role migration. If it ever does, this is wrong in
 * the direction of naming a real role that is no longer the default, which is a readable mistake.
 */
const DOCUMENT_TEXT_ROLE = 'text';

/** The colour a border shorthand names, if it names one: "1px solid border" → "border". */
export function borderColorOf(props: Record<string, unknown>): string | undefined {
  const explicit = props.borderColor;
  if (typeof explicit === 'string' && explicit) return explicit;
  const shorthand = props.border;
  if (typeof shorthand !== 'string') return undefined;
  // The colour is the last of the three parts, and only interesting when it is a token rather than
  // a raw CSS colour — a hex has no role to jump to.
  const last = shorthand.trim().split(/\s+/).pop();
  return last && /^[a-z][a-z0-9-]*$/.test(last) ? last : undefined;
}

export function paintedRoles(
  node: { type?: string; props?: Record<string, unknown> },
  ancestors: { type?: string; props?: Record<string, unknown> }[],
): PaintedRole[] {
  const chain = [node, ...ancestors];
  const out: PaintedRole[] = [];

  const inherited = (what: string, read: (p: Record<string, unknown>) => string | undefined) => {
    for (let i = 0; i < chain.length; i++) {
      const value = read(chain[i].props ?? {});
      if (typeof value === 'string' && value) {
        out.push({ what, value, from: i === 0 ? undefined : (chain[i].type ?? '?') });
        return true;
      }
    }
    return false;
  };

  // A background genuinely may not exist: nothing above this node paints, so it is on the page and
  // saying `page` would be a guess about a root this fragment cannot see.
  inherited('Background', (p) => (typeof p.bg === 'string' ? p.bg : undefined));
  // Text always exists — see `fromDocument`. The template merely may not be the one deciding it.
  if (!inherited('Text', (p) => (typeof p.color === 'string' ? p.color : undefined))) {
    out.push({ what: 'Text', value: DOCUMENT_TEXT_ROLE, fromDocument: true });
  }
  // A border is not inherited, so only the node's own counts — an ancestor's border is not this
  // element's, and reporting one would send somebody to change a line they are not looking at.
  const own = borderColorOf(node.props ?? {});
  if (own) out.push({ what: 'Border', value: own });

  return out;
}
