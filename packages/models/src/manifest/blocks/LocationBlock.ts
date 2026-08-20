import type { CoreEntityDef } from '../defs';

export const LocationBlock: CoreEntityDef = {
  base: 'WeNode',
  optional: ['city', 'country', 'countryCode'],
  entity: {
    flag: { predicate: 'we://flag', value: 'we://location_block' },
    // `city`/`country`/`countryCode` are filled in by reverse geocoding, not typed.
    authoring: { fields: ['name', 'latitude', 'longitude', 'address'] },
    properties: {
      name: { type: 'string', predicate: 'we://name', default: '' },
      latitude: { type: 'number', predicate: 'we://latitude', required: true, default: 0 },
      longitude: { type: 'number', predicate: 'we://longitude', required: true, default: 0 },
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
