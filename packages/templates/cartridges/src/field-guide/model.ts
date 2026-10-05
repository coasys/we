/**
 * What the field guide is about: species, and sightings of them at places.
 *
 * Two shapes a community could have made in the model wizard. Neither exists in WE: the app is
 * built on kinds of thing it defines itself, which is the claim this cartridge is here to test.
 * Places and photos are core models (`LocationBlock`, `ImageBlock`), so the globe and the media
 * pipeline already understand them.
 */
import type { FixtureAgent, FixtureRecord } from '@we/template-fixtures';
import { PLATES } from '@we/template-fixtures';

import { shape } from '../cartridge.ts';

export const GROUPS = ['bird', 'mammal', 'insect', 'plant', 'fungus', 'reptile'] as const;

export const speciesShape = shape('Species', {
  icon: 'leaf',
  description: 'A kind of living thing the group records.',
  hint: 'A species, by its common name, with its scientific name and the group it belongs to.',
  title: 'commonName',
  summary: 'scientificName',
  properties: {
    commonName: { type: 'string', required: true, identity: true },
    scientificName: { type: 'string' },
    group: { type: 'string', options: [...GROUPS], default: 'bird' },
    status: { type: 'string', options: ['common', 'uncommon', 'rare', 'protected'], default: 'common' },
    description: { type: 'string', control: 'textarea' },
  },
  relations: { photo: { target: 'ImageBlock', cardinality: 'one' } },
});

export const sightingShape = shape('Sighting', {
  icon: 'binoculars',
  description: 'One observation of a species, at a place and a time.',
  hint: 'Somebody saw a species somewhere: what, where, when, how many, and how sure they are.',
  title: 'title',
  summary: 'notes',
  properties: {
    title: { type: 'string', required: true },
    seenAt: { type: 'datetime', required: true },
    count: { type: 'number', default: 1 },
    certainty: { type: 'string', options: ['certain', 'likely', 'unsure'], default: 'certain' },
    notes: { type: 'string', control: 'textarea' },
  },
  relations: {
    species: { target: 'Species', cardinality: 'one' },
    place: { target: 'LocationBlock', cardinality: 'one' },
  },
});

export const agents: FixtureAgent[] = [
  { did: 'did:fg:wren', firstName: 'Wren', lastName: 'Ashby', handle: 'wren', bio: 'Reed-bed counts, Tuesdays.' },
  { did: 'did:fg:tom', firstName: 'Tom', lastName: 'Okafor', handle: 'tomo', bio: 'Moths, mostly.' },
  { did: 'did:fg:ines', firstName: 'Inês', lastName: 'Duarte', handle: 'ines', bio: 'Orchids and fungi.' },
  { did: 'did:fg:sam', firstName: 'Sam', lastName: 'Hale', handle: 'samh', bio: 'Otter survey lead.' },
];

const places: Array<[id: string, name: string, lat: number, lng: number]> = [
  ['shapwick', 'Shapwick Heath', 51.163, -2.818],
  ['hamwall', 'Ham Wall', 51.153, -2.787],
  ['westhay', 'Westhay Moor', 51.183, -2.783],
  ['cheddar', 'Cheddar Gorge', 51.284, -2.763],
  ['steart', 'Steart Marshes', 51.205, -3.041],
  ['tor', 'Glastonbury Tor', 51.144, -2.698],
];

const species: Array<
  [id: string, common: string, scientific: string, group: string, status: string, description: string]
> = [
  [
    'kingfisher',
    'Kingfisher',
    'Alcedo atthis',
    'bird',
    'uncommon',
    'A flash of blue low over still water; listen for the thin whistle first.',
  ],
  [
    'bittern',
    'Bittern',
    'Botaurus stellaris',
    'bird',
    'rare',
    'Booms in spring from deep reed; almost never seen in the open.',
  ],
  [
    'egret',
    'Great White Egret',
    'Ardea alba',
    'bird',
    'uncommon',
    'Tall, white, black-legged; now breeding on the Levels.',
  ],
  [
    'otter',
    'Otter',
    'Lutra lutra',
    'mammal',
    'protected',
    'Spraint on rocks and bridges is the usual sign; dawn is best.',
  ],
  [
    'commonblue',
    'Common Blue',
    'Polyommatus icarus',
    'insect',
    'common',
    'Small and bright on bird’s-foot trefoil through late summer.',
  ],
  [
    'orchid',
    'Southern Marsh Orchid',
    'Dactylorhiza praetermissa',
    'plant',
    'uncommon',
    'Magenta spikes in damp meadows, June into July.',
  ],
  [
    'flyagaric',
    'Fly Agaric',
    'Amanita muscaria',
    'fungus',
    'common',
    'Under birch in autumn. Look, photograph, leave it be.',
  ],
  [
    'grasssnake',
    'Grass Snake',
    'Natrix helvetica',
    'reptile',
    'protected',
    'Yellow collar; swims well and basks on rhyne banks.',
  ],
];

const sightings: Array<
  [id: string, species: string, place: string, by: string, at: string, count: number, certainty: string, notes: string]
> = [
  [
    's1',
    'kingfisher',
    'shapwick',
    'did:fg:wren',
    '2026-10-04T07:40',
    1,
    'certain',
    'Perched on the sluice post, then off upstream.',
  ],
  [
    's2',
    'bittern',
    'hamwall',
    'did:fg:wren',
    '2026-10-03T08:15',
    1,
    'likely',
    'Flew across the main drove, low into reed.',
  ],
  ['s3', 'egret', 'hamwall', 'did:fg:sam', '2026-10-03T09:00', 4, 'certain', 'Four together on the Avalon hide pool.'],
  [
    's4',
    'otter',
    'westhay',
    'did:fg:sam',
    '2026-10-02T06:20',
    2,
    'certain',
    'Mother and cub under the footbridge at first light.',
  ],
  [
    's5',
    'flyagaric',
    'cheddar',
    'did:fg:ines',
    '2026-10-01T14:30',
    7,
    'certain',
    'A ring of seven under the birches above the gorge.',
  ],
  [
    's6',
    'grasssnake',
    'shapwick',
    'did:fg:tom',
    '2026-09-28T13:10',
    1,
    'certain',
    'Basking on the rhyne bank by the eastern hide.',
  ],
  [
    's7',
    'kingfisher',
    'steart',
    'did:fg:tom',
    '2026-09-27T10:05',
    2,
    'certain',
    'A pair chasing along the creek edge.',
  ],
  [
    's8',
    'commonblue',
    'tor',
    'did:fg:tom',
    '2026-09-20T15:45',
    12,
    'certain',
    'Late brood still flying on the south slope.',
  ],
  ['s9', 'egret', 'steart', 'did:fg:wren', '2026-09-18T17:30', 9, 'certain', 'Roosting in the willows at dusk.'],
  [
    's10',
    'otter',
    'shapwick',
    'did:fg:sam',
    '2026-09-15T05:55',
    1,
    'unsure',
    'Ripple and a tail — could have been mink.',
  ],
  [
    's11',
    'orchid',
    'westhay',
    'did:fg:ines',
    '2026-07-02T11:00',
    40,
    'certain',
    'The damp meadow by the car park, best year yet.',
  ],
  [
    's12',
    'bittern',
    'shapwick',
    'did:fg:wren',
    '2026-04-11T05:30',
    2,
    'certain',
    'Two booming males, one either side of the track.',
  ],
  [
    's13',
    'grasssnake',
    'westhay',
    'did:fg:tom',
    '2026-06-21T12:40',
    1,
    'likely',
    'Swimming across the rhyne, head up.',
  ],
  [
    's14',
    'flyagaric',
    'westhay',
    'did:fg:ines',
    '2026-09-30T10:20',
    3,
    'certain',
    'First of the season on the birch edge.',
  ],
];

const byId = new Map(species.map(([id, common]) => [id, common]));
const placeName = new Map(places.map(([id, name]) => [id, name]));

export const records: FixtureRecord[] = [
  ...places.map(([id, name, latitude, longitude]) => ({
    entity: 'LocationBlock',
    id: `place-${id}`,
    fields: { name, latitude, longitude, city: 'Somerset Levels', country: 'United Kingdom', countryCode: 'GB' },
  })),
  ...species.map(([id], index) => ({
    entity: 'ImageBlock',
    id: `photo-${id}`,
    fields: { src: PLATES[index % PLATES.length], altText: byId.get(id) ?? '' },
  })),
  ...species.map(([id, commonName, scientificName, group, status, description]) => ({
    entity: 'Species',
    id: `species-${id}`,
    fields: { commonName, scientificName, group, status, description },
    relations: { photo: `photo-${id}` },
    author: 'did:fg:ines',
    createdAt: '2026-04-01T09:00',
  })),
  ...sightings.map(([id, speciesId, place, by, seenAt, count, certainty, notes]) => ({
    entity: 'Sighting',
    id: `sighting-${id}`,
    fields: { title: `${byId.get(speciesId)} at ${placeName.get(place)}`, seenAt, count, certainty, notes },
    relations: { species: `species-${speciesId}`, place: `place-${place}` },
    author: by,
    createdAt: seenAt,
  })),
];
