/**
 * Narrowing a whole view to one container — the general form of "the tasks from this call".
 *
 * ## The parameter
 *
 * A view reads its anchor from the URL query parameter `?anchor=<collection id>`. Absent means the
 * whole space, which is what every one of these views has always shown, so nothing about an
 * unanchored view changes.
 *
 * A query parameter rather than a route segment, for two reasons. It is view state by the routing
 * conventions' own test — send somebody the link and they should see what you see — and a segment
 * would make the shell's route tree learn about anchors, which is a fact about a view rather than
 * about where views live. Read straight from `routeStore.params` rather than declared as
 * `$localState` with a `syncParam`, because a view does not *own* this value: it is written by
 * whoever linked here — a call card offering "the work from this call" — and a view that declared
 * it would clear it on mount whenever its own initial disagreed.
 *
 * ## Why absence is safe
 *
 * `scope` is dropped by the renderer when its `anchorId` does not resolve, the same rule
 * `pruneUnresolvedWhere` applies to a `where` — see `scopeIsAnchored`. That is what lets a view
 * carry {@link anchorScope} on every query unconditionally: no `$if` around a duplicated query, no
 * blank screen when nobody named a container. Without it an unresolved anchor would be a perfectly
 * valid request for the children of no record, which answers nothing, silently.
 *
 * ## One level, and that is deliberate
 *
 * `via: 'children'` resolves a single hop: the anchor's own children, not its descendants. Every
 * case that exists today is one level — a call's records hang directly off the call's collection —
 * and recursive resolution costs a traversal per query on a backend where a relation read is a link
 * query. When a real nested case turns up it slots in behind this same parameter, because a view
 * passes the anchor rather than the shape of the walk.
 */
import type { AnchorId } from '@we/schema-kit';
import type { QueryStateField, SchemaNode } from '@we/schema-shared';

/** The query parameter carrying the anchor. Exported so a link builder and a view agree on it. */
export const ANCHOR_PARAM = 'anchor';

/** The anchor a view is narrowed to, as an expression — empty when there is none. */
export const ANCHOR_ID = { $: `routeStore.params.${ANCHOR_PARAM}` };

/**
 * The `scope` clause narrowing a query to the anchored container's children.
 *
 * Returns a fresh object per call: a schema is data that gets walked and resolved, and sharing one
 * literal across a dozen queries makes a debugging session about identity rather than about the
 * query. Pass it as a query's `scope`; when the parameter is absent the renderer drops it and the
 * query is space-wide.
 *
 * The `anchor` is always `CollectionBlock` because that is what containers are in WE — a call's
 * record, a post, a channel and a board are all one shape, which is the property that makes this
 * one parameter rather than one per surface.
 */
export function anchorScope(anchorId: AnchorId = ANCHOR_ID): NonNullable<QueryStateField['scope']> {
  return { anchor: 'CollectionBlock', via: 'children', anchorId };
}

export interface AnchorBannerOptions {
  /** What the view calls its rows, for the sentence: "Showing the **tasks** from …". */
  label: string;
}

/**
 * A line saying the view is narrowed, and a way out of it.
 *
 * Not optional chrome. An anchored view and an empty space look identical — a Tasks route showing
 * three of forty tasks is indistinguishable from a space with three tasks in it — and the parameter
 * arrives from a link somebody else built, so the reader may never have chosen it. A filter nobody
 * can see is a filter nobody can turn off.
 *
 * Renders nothing when unanchored, so the query inside it never runs on an ordinary view.
 */
export function anchorBanner(opts: AnchorBannerOptions): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: ANCHOR_ID,
      then: {
        type: 'Row',
        $queries: {
          anchorRecord: {
            entity: 'CollectionBlock',
            where: { id: ANCHOR_ID },
            limit: 1,
          },
        },
        props: {
          width: '100%',
          gap: '300',
          ay: 'center',
          px: '300',
          py: '200',
          bg: 'accent-muted',
          r: '300',
        },
        children: [
          { type: 'we-icon', props: { name: 'funnel', color: 'accent-text' } },
          {
            type: 'we-text',
            props: { fontSize: '200' },
            children: [
              {
                /*
                  Falls back to the id's own words rather than to nothing. The record may be in
                  another dataset, or not have arrived yet, and "Showing the tasks from" trailing off
                  reads as a bug — where naming something unresolved at least says which link is
                  responsible.
                */
                $: `\`Showing the ${opts.label} from \${first(local.anchorRecord).title ?? 'a container elsewhere'}\``,
              },
            ],
          },
          {
            type: 'we-button',
            props: {
              variant: 'ghost',
              size: 'xs',
              ml: 'auto',
              // `null` clears the parameter; `push: true` because leaving a narrowed view is a
              // navigation somebody may want to undo with Back.
              onClick: { $action: 'routeStore.setParam', args: [ANCHOR_PARAM, null, { push: true }] },
            },
            children: ['Show all'],
          },
        ],
      },
    },
  };
}

/**
 * The predicate a `CollectionBlock`'s children hang off. The one place a schema needs to name it.
 */
const CHILDREN_PREDICATE = 'we://children';

/**
 * The options a `record.create` needs to put what it makes *inside* the anchored container.
 *
 * The write half of {@link anchorScope}, and it has to exist for the same reason the scope does: a
 * narrowed view that could not create into what it is narrowed to would make a task, congratulate
 * itself, and show nothing — the record is real and in the space, but not in the container being
 * looked at.
 *
 * Resolves to `{}` when there is no anchor, which `record.create` treats as no options at all, so
 * the same call serves both cases. Pass an expression naming a different anchor where a template has
 * one of its own — the Workshop names the call it is about rather than a URL parameter.
 */
export function anchorParent(anchorExpr = `routeStore.params.${ANCHOR_PARAM}`): { $: string } {
  return {
    $: `(${anchorExpr}) ? { parent: { id: ${anchorExpr}, predicate: '${CHILDREN_PREDICATE}' } } : {}`,
  };
}
