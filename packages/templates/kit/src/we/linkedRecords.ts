import type { SchemaNode } from '@we/schema-shared';

export interface LinkedRecordsOptions {
  /** Expression for the record whose relation is being read — `'row'`. */
  record: string;
  /** Expression for the relation's display field, carrying `name` and `target` — `'field'`. */
  field: string;
}

/**
 * What one relation of a record points at: pictures as pictures, everything else by name.
 *
 * A relation holds ids — one for a to-one, a list for a to-many — and an id is nothing to read. So
 * the records are looked up by those ids, as the model they belong to, and drawn the way that model
 * asks to be named (`recordStore.displays[target].title`), or as images where the target is one.
 * A sighting's photos and the site it was seen at, with nothing written for either model.
 *
 * Shared by the record page and the Workshop inspector, which answered this separately and so did
 * not answer it at all: the inspector left relations out, and the page drew each id as text.
 *
 * `when` gates the lookup on there being ids, because an unresolved operand is pruned from a query
 * rather than sent — and a lookup with its `where` pruned asks for every record of the model.
 */
export function linkedRecords({ record, field }: LinkedRecordsOptions): SchemaNode {
  const ids = `${record}[${field}.name]`;
  const lookup = (entity: unknown, limit: number) => ({
    entity,
    where: { id: { $: ids } },
    when: { $: ids },
    limit,
  });

  return {
    type: '$if',
    props: {
      condition: { $: `${field}.target == 'ImageBlock'` },
      then: {
        type: 'Row',
        props: { gap: '200', wrap: true, width: '100%' },
        $queries: { pictures: lookup('ImageBlock', 24) },
        children: [
          {
            type: '$each',
            props: { items: { $: 'local.pictures' }, as: 'picture' },
            children: [
              {
                type: 'we-image',
                props: {
                  src: { $: 'picture.src' },
                  alt: { $: "picture.altText ?? ''" },
                  fit: 'cover',
                  r: 'surface',
                  // One picture takes the width; several sit as tiles.
                  width: { $: "count(local.pictures) == 1 ? '100%' : '96px'" },
                  height: { $: "count(local.pictures) == 1 ? 'auto' : '96px'" },
                },
              },
            ],
          },
        ],
      },
      else: {
        type: 'Row',
        props: { gap: '200', wrap: true, minWidth: '0' },
        $queries: { linked: lookup({ $: `${field}.target` }, 50) },
        children: [
          {
            type: '$each',
            props: { items: { $: 'local.linked' }, as: 'other' },
            children: [
              {
                type: 'we-badge',
                children: [
                  {
                    $: `other[recordStore.displays[${field}.target].title] ?? recordStore.displays[${field}.target].label ?? ${field}.target`,
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}
