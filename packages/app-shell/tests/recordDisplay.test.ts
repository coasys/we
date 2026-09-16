import type { EntitySchema } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

import { displayFor, kindFor, modelLabel } from '../src/shared/shapes/recordDisplay';

const sighting: EntitySchema = {
  properties: {
    species: { type: 'string', required: true },
    notes: { type: 'string', control: 'textarea' },
    photo: { type: 'string', format: 'file' },
    attachment: { type: 'string', format: 'file' },
    seenAt: { type: 'datetime' },
    confirmed: { type: 'boolean' },
    count: { type: 'number' },
    status: { type: 'string', options: ['new', 'verified'] },
    link: { type: 'string', control: 'url' },
    extra: { type: 'json' },
  },
  relations: {},
};

describe('displayFor', () => {
  it('derives title, summary and media from a community shape with no hints', () => {
    const display = displayFor({ entity: 'Sighting', schema: sighting, authorable: true, icon: 'binoculars' });
    expect(display.title).toBe('species');
    expect(display.summary).toBe('notes');
    expect(display.media).toBe('photo');
    expect(display.label).toBe('Sighting');
    expect(display.icon).toBe('binoculars');
    expect(display.fields.map((f) => f.name)).toEqual(Object.keys(sighting.properties));
    expect(display.fields.find((f) => f.name === 'species')?.role).toBe('title');
    expect(display.fields.find((f) => f.name === 'count')?.role).toBe('detail');
    expect(display.fields.find((f) => f.name === 'seenAt')?.label).toBe('Seen at');
  });

  it('shows a core entity only what it declares, in that order', () => {
    const post: EntitySchema = {
      properties: {
        version: { type: 'number' },
        title: { type: 'string', required: true },
        body: { type: 'string', control: 'textarea' },
      },
      relations: {},
      authoring: { fields: ['title', 'body'] },
    };
    const display = displayFor({ entity: 'Post', schema: post, authorable: false });
    expect(display.fields.map((f) => f.name)).toEqual(['title', 'body']);
    expect(display.icon).toBe('cube');
  });

  it('lets the declaration override every guess', () => {
    const declared: EntitySchema = {
      ...sighting,
      display: {
        title: 'status',
        summary: 'link',
        media: 'attachment',
        fields: ['status', 'link', 'attachment', 'ghost'],
      },
    };
    const display = displayFor({ entity: 'Sighting', schema: declared, authorable: true });
    expect(display.title).toBe('status');
    expect(display.summary).toBe('link');
    expect(display.media).toBe('attachment');
    // A declared field the entity does not have is a manifest error, not an empty row.
    expect(display.fields.map((f) => f.name)).toEqual(['status', 'link', 'attachment']);
  });

  it('heads a card with what names the record, not with its one required field', () => {
    /*
      `displayFor` used to pick "the first required string" over the *shown* field list, which is
      how a code block came to be headed by its entire code body with its actual title on the
      summary line beneath it, and a link by its URL. It asks `namePropertyOf` now — see its
      docblock, and `recordName.test.ts` for the rule.
    */
    const code = CORE_MANIFEST.entities.CodeBlock;
    expect(displayFor({ entity: 'CodeBlock', schema: code, authorable: false }).title).toBe('title');

    const link = CORE_MANIFEST.entities.LinkBlock;
    expect(displayFor({ entity: 'LinkBlock', schema: link, authorable: false }).title).toBe('title');
  });

  it('names a composed document, which declares no fields to ask for', () => {
    // A note goes through the composer rather than a form, so it has no `authoring` list — and the
    // old guess searched only that list, leaving it nameless while `title` sat right there. The
    // panel then said "Untitled" over a card the canvas had labelled from its text.
    const collection = CORE_MANIFEST.entities.CollectionBlock;
    const display = displayFor({ entity: 'CollectionBlock', schema: collection, authorable: false });
    expect(display.title).toBe('title');
    expect(display.summary).toBe('description');
    // Still no field rows: what a note says is its content, not a list of properties.
    expect(display.fields.filter((f) => f.kind !== 'relation')).toEqual([]);
  });

  it('answers with empty roles rather than guessing wrongly', () => {
    const numbers: EntitySchema = { properties: { x: { type: 'number' }, y: { type: 'number' } }, relations: {} };
    const display = displayFor({ entity: 'Point', schema: numbers, authorable: true });
    expect(display.title).toBe('');
    expect(display.summary).toBe('');
    expect(display.media).toBe('');
    expect(display.fields.every((f) => f.role === 'detail')).toBe(true);
  });
});

describe('kindFor', () => {
  it.each([
    ['photo', { type: 'string', format: 'file' }, 'image'],
    ['attachment', { type: 'string', format: 'file' }, 'file'],
    ['status', { type: 'string', options: ['a'] }, 'text'],
    ['notes', { type: 'string', control: 'textarea' }, 'longText'],
    ['site', { type: 'string', control: 'url' }, 'url'],
    ['day', { type: 'string', control: 'date' }, 'date'],
    ['at', { type: 'datetime' }, 'datetime'],
    ['tint', { type: 'string', control: 'color' }, 'color'],
    ['done', { type: 'boolean' }, 'boolean'],
    ['n', { type: 'number' }, 'number'],
    ['blob', { type: 'json' }, 'json'],
    ['name', { type: 'string' }, 'text'],
  ] as const)('%s → %s', (name, property, kind) => {
    expect(kindFor(name, property as never)).toBe(kind);
  });
});

/**
 * A connection is shown even though it cannot be created from the picker.
 *
 * These are two questions and the store answered them with one list. `Relationship` is excluded from
 * `creatableEntities` on purpose — a connection is *drawn* between two things rather than filled in
 * from a form, so offering it there would offer two endpoints nobody had chosen — and `displays` was
 * derived from that list, which quietly made "cannot be created here" mean "cannot be displayed".
 *
 * The symptom was an empty inspector for a connector whose own name was drawn on the line beside it.
 * Nothing failed: the record was found, the panel mounted, and every field read off a display that
 * was `undefined`.
 *
 * Asserted against the manifest rather than against the store, which needs a live space — what is
 * being pinned is that the declaration a display is built from is there and says something useful.
 */
describe('a connection is displayable', () => {
  const relationship = CORE_MANIFEST.entities.Relationship;

  it('is declared, and declares the fields somebody fills in', () => {
    // The premise. Without an `authoring` declaration there would be nothing to derive a display
    // from, and excluding it from the picker would be the whole story rather than half of it.
    expect(relationship).toBeDefined();
    expect(relationship.authoring?.fields).toContain('label');
  });

  it('derives a display with something to read on it', () => {
    const display = displayFor({
      entity: 'Relationship',
      schema: relationship,
      authorable: false,
      icon: 'arrow-right',
    });

    // A title is what the inspector leads with; without one the panel is blank whatever else is on
    // the record. `label` is the connection's own name — the string already drawn on the line.
    expect(display.title).toBe('label');
    expect(display.fields.length).toBeGreaterThan(0);
  });
});

describe('relations, which a card could not see at all', () => {
  /*
    `fields` was built from `properties` alone, so a declared edge to another record was absent from
    the very thing whose job is to describe how a model is shown — and absent silently: the card
    rendered nothing rather than rendering wrongly, with no diagnostic anywhere.
  */
  const meeting: EntitySchema = {
    properties: {
      title: { type: 'string', required: true },
      startsAt: { type: 'datetime' },
    },
    relations: {
      place: { target: 'LocationBlock', cardinality: 'one' },
      guests: { target: 'AgentProfile', cardinality: 'many' },
    },
  };

  it('lists a relation as a field, naming what it points at', () => {
    const display = displayFor({ entity: 'Meeting', schema: meeting, authorable: true });

    const place = display.fields.find((f) => f.name === 'place');
    expect(place?.kind).toBe('relation');
    expect(place?.target).toBe('LocationBlock');
    expect(place?.many).toBe(false);
    expect(place?.role).toBe('detail');
    expect(place?.label).toBe('Place');
  });

  it('says which relations hold a list', () => {
    const display = displayFor({ entity: 'Meeting', schema: meeting, authorable: true });

    expect(display.fields.find((f) => f.name === 'guests')?.many).toBe(true);
  });

  it('leaves the scalars where the declaration put them and appends what it did not place', () => {
    // A relation named in neither `display.fields` nor `authoring.fields` has no declared position,
    // so the stable answer is "after what was ordered" rather than wherever the object happened to
    // iterate. Scalars keep their order regardless.
    const display = displayFor({ entity: 'Meeting', schema: meeting, authorable: true });

    expect(display.fields.map((f) => f.name)).toEqual(['title', 'startsAt', 'place', 'guests']);
  });

  it('gives a scalar field no target to confuse a relation with', () => {
    const display = displayFor({ entity: 'Meeting', schema: meeting, authorable: true });

    expect(display.fields.find((f) => f.name === 'title')?.target).toBe('');
  });
});

describe('an event, as the declaration now describes it', () => {
  const event = CORE_MANIFEST.entities.EventBlock;

  it('keeps the dedup key and the all-day flag off a card', () => {
    /*
      `occurrence`'s own note calls it "a dedup key, not a display value" — it is the title and the
      date glued together, and it was reaching review cards as a third redundant field. `allDay` is
      redundant differently: a card draws a midnight time as a bare date, so an all-day event already
      looks like one. Both stay available to a *form*, which has to set what a card can infer.
    */
    const display = displayFor({ entity: 'EventBlock', schema: event, authorable: false });

    expect(display.fields.map((f) => f.name)).not.toContain('occurrence');
    expect(display.fields.map((f) => f.name)).not.toContain('allDay');
    expect(event.authoring?.fields).toContain('allDay');
  });

  it('carries the place as a relation to the model that already holds places', () => {
    // `we://location` meant a literal here and a `LocationBlock` on `Space` — one predicate, two
    // shapes, which is the version of predicate sharing that cannot work.
    expect(event.properties.location).toBeUndefined();
    expect(event.relations.location).toEqual({
      target: 'LocationBlock',
      cardinality: 'one',
      predicate: 'we://location',
    });

    const display = displayFor({ entity: 'EventBlock', schema: event, authorable: false });
    expect(display.fields.find((f) => f.name === 'location')?.target).toBe('LocationBlock');
  });

  it('lets a place be named without being placed', () => {
    /*
      `latitude`/`longitude` were `required` with a `default: 0`, which guaranteed a number was
      present and never that it meant anything — a location created without coordinates silently
      claimed Null Island. Optional with no default makes "nobody has placed this yet" sayable, which
      matters because a model hearing "Bristol" has a name and no coordinates.
    */
    const location = CORE_MANIFEST.entities.LocationBlock;

    expect(location.properties.latitude.required).toBeUndefined();
    expect(location.properties.latitude.default).toBeUndefined();
    expect(location.properties.longitude.required).toBeUndefined();
    expect(location.properties.name.identity).toBe(true);
  });
});

describe('what a model is called on screen', () => {
  it('drops the layer word a reader has no use for', () => {
    // `Block` says which layer of WE a class belongs to. That matters in the codebase and to nobody
    // reading a card, which announced `EVENTBLOCK` over a trip to Bristol.
    expect(modelLabel('EventBlock')).toBe('Event');
    expect(modelLabel('TaskBlock')).toBe('Task');
  });

  it('leaves a model that is not one alone', () => {
    expect(modelLabel('Relationship')).toBe('Relationship');
    expect(modelLabel('Shape')).toBe('Shape');
  });

  it('humanises a compound name rather than running it together', () => {
    expect(modelLabel('CollectionBlock')).toBe('Collection');
    expect(modelLabel('SignalType')).toBe('Signal type');
  });
});

describe('a picture held by relation', () => {
  const sighting: EntitySchema = {
    properties: { species: { type: 'string', required: true } },
    relations: {
      site: { target: 'Site', cardinality: 'one' },
      photos: { target: 'ImageBlock', cardinality: 'many' },
    },
  };

  it('is the record’s picture when no property is, and leaves the detail rows', () => {
    const display = displayFor({ entity: 'Sighting', schema: sighting, authorable: true });
    expect(display.media).toBe('');
    expect(display.mediaRelation).toBe('photos');
    expect(display.fields.find((f) => f.name === 'photos')?.role).toBe('media');
    expect(display.fields.find((f) => f.name === 'site')?.role).toBe('detail');
  });

  it('gives way to a property that pictures the record, which a template can draw directly', () => {
    const withCover: EntitySchema = {
      ...sighting,
      properties: { ...sighting.properties, cover: { type: 'string', format: 'file' } },
    };
    const display = displayFor({ entity: 'Sighting', schema: withCover, authorable: true });
    expect(display.media).toBe('cover');
    expect(display.mediaRelation).toBe('');
  });
});
