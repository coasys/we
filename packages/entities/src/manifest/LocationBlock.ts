import type { CoreEntityDef } from './defs';

export const LocationBlock: CoreEntityDef = {
  base: 'WeNode',
  optional: ['city', 'country', 'countryCode', 'latitude', 'longitude'],
  entity: {
    blockable: true,
    description: 'A place on the map',
    flag: { predicate: 'we://flag', value: 'we://location_block' },
    interpretationHint:
      'A place something happens — a city, a venue, an address, as it was said. Create one only to attach it to something else that needs a where; a place nobody is meeting at is not worth recording. Give the name as spoken and leave the coordinates alone: they are filled in later by geocoding, and a guessed one puts a pin in the wrong country.',
    // The pin fills the coordinates, and reverse geocoding the address, city and country — all of
    // which stay editable, since a geocoder's answer for a field or a hillside is often not the name
    // anybody uses.
    authoring: { fields: ['name', 'latitude', 'longitude', 'address', 'city', 'country', 'countryCode'] },
    properties: {
      /**
       * What the place is called, and what makes two mentions of it the same place.
       *
       * `identity` because without one this class is invisible to dedup: the executor skips a class
       * with no identity property when it assembles the "instances that already exist" block, so the
       * model never sees what is already here and every pass mints a fresh one. Three mentions of
       * Bristol in a call would be three records.
       *
       * The name rather than the coordinates, because the coordinates are exactly what a speaker
       * does not supply — see below. It carries the same denormalisation caveat `EventBlock`'s
       * `occurrence` documents: nothing recomputes it, and two genuinely different venues sharing a
       * name will merge. That degrades in the safe direction for a *place*, where the name is what
       * anybody says and what anybody reads.
       */
      name: { type: 'string', predicate: 'we://name', identity: true, default: '' },
      /**
       * Where it is, when anybody knows — and absent when nobody does.
       *
       * ## Why these are optional, and why the default went with the requirement
       *
       * They were `required: true, default: 0`, which sounds like a guarantee and is not one.
       * `minCount` is metadata the executor surfaces rather than a constraint it enforces on write,
       * and the default fires at construction — so a location created without coordinates silently
       * claimed `0, 0`: Null Island, in the Gulf of Guinea. The requirement guaranteed that a number
       * was present, never that it meant anything.
       *
       * So there is no guarantee to lose here, only a lie to stop telling. Optional with no default
       * makes "nobody has placed this yet" representable, and `{ latitude: { exists: false } }` asks
       * for exactly that — a list worth having rather than a gap.
       *
       * ## Why not make the model supply them
       *
       * It would. That is the problem: an LLM produces confident coordinates for "Bristol" and
       * equally confident ones for "the Red Lion on Church Street", and WE draws locations on a
       * globe. A wrong pin is worse than a missing one, because nothing about it looks wrong.
       *
       * Anything plotting these must now skip a location with no coordinates. That is not a new
       * burden: it was already plotting Null Island for every one of them, and this makes the
       * problem visible rather than creating it.
       */
      latitude: { type: 'number', predicate: 'we://latitude' },
      longitude: { type: 'number', predicate: 'we://longitude' },
      address: { type: 'string', predicate: 'we://address', control: 'textarea', default: '' },
      city: { type: 'string', predicate: 'we://city' },
      /** ISO 3166-1 alpha-2 code (e.g. 'DE'). Use for filtering/grouping; display country for labels. */
      countryCode: { type: 'string', predicate: 'we://country_code' },
      country: { type: 'string', predicate: 'we://country' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
