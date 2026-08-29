import type { SchemaNode } from '@we/schema-shared';

/**
 * A link to a record's own page — the affordance that makes the route reachable.
 *
 * A real `href` rather than a click handler, because everything people expect of a link depends on
 * it: middle-click, open in a new tab, copy link address, and the browser's own idea of what has
 * been visited. A `we-button` with `onClick: routeStore.navigate` looks identical and supports none
 * of them. Solid Router resolves the click through `composedPath()`, so the anchor inside the
 * primitive's shadow root is still intercepted and the navigation stays client-side.
 *
 * ## Why the path is built from `spaceStore.spacePath`
 *
 * The route is injected where a shell puts its sections, which for every WE shell is under
 * `/space/:spaceId` — so a bare `/record/…` is a different route entirely and lands on the
 * template's not-found. That was the first version of this, and it 404'd on every click.
 *
 * A *relative* href does not fix it either: a browser resolves one against the current URL, not
 * against the route tree, so `./record/…` is right from `/space/x/cards` and wrong the moment a
 * section has a sub-route of its own. The prefix has to come from the host, and the segment it
 * contains is not a value a schema can compute — for a shared space it is the neighbourhood CID and
 * for a personal one the dataset id.
 *
 * ## Why the id is a query value
 *
 * Because a record's id is a URI — `ad4m://obj/<random>` — and a URI is not one path segment. As
 * `/record/CollectionBlock/ad4m://obj/x` it is five, and the route does not match: the second
 * version of this, which 404'd exactly as visibly as the first. A query value takes `:` and `/`
 * literally, so nothing has to be encoded and nothing has to be decoded back.
 *
 * Takes the entity and the id as expressions so it can be dropped into any `$each` — the row names
 * differ per list, and this has no business knowing them.
 */
export function recordLink(entity: unknown, id: unknown): SchemaNode {
  return {
    /*
      Absent outside a space, rather than pointing nowhere.

      `spacePath` is empty when there is no space in the path — a card list rendered in Settings, for
      instance, which `installedList` genuinely is — and the record route is mounted *inside* a
      space, so a link built without the prefix goes to the template's not-found. That was the first
      version of this and it 404'd on every click.
    */
    type: '$if',
    props: {
      condition: { $: 'spaceStore.spacePath' },
      then: {
        type: 'we-button',
        props: {
          variant: 'ghost',
          size: 'sm',
          square: true,
          title: 'Open',
          href: {
            $: `\`\${spaceStore.spacePath}/record/\${${(entity as { $: string }).$}}/\${${(id as { $: string }).$}}\``,
          },
        },
        children: [{ type: 'we-icon', props: { name: 'arrows-out-simple' } }],
      },
    },
  };
}
