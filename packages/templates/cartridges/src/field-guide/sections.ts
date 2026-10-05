/**
 * The field guide's sections: what lives here, what has been seen, and where.
 *
 * Each reads the cartridge's own shapes — `Species`, `Sighting` — exactly as a built-in section
 * reads a core model, with a `$query` and an `include` for the places and photos they point at.
 */
import type { TemplateSchema } from '@we/schema-shared';

import { GROUPS } from './model.ts';

const GROUP_ICON =
  "{ bird: 'bird', mammal: 'paw-print', insect: 'bug', plant: 'flower', fungus: 'tree', reptile: 'feather' }";
const page = { width: '100%', maxWidth: 'var(--we-layout-lg)', px: '600', py: '500', gap: '500' };

export const speciesSection: TemplateSchema & { id: string } = {
  id: 'field-guide-species',
  meta: { name: 'Species', description: 'What the group records', icon: 'leaf', role: 'view', segment: 'species' },
  type: 'Column',
  props: { width: '100%', ax: 'center' },
  $queries: {
    species: { entity: 'Species', include: { photo: true }, order: { commonName: 'asc' }, limit: 200 },
    sightings: { entity: 'Sighting', select: ['species'], limit: 1000 },
  },
  $localState: { group: { type: 'string', initial: '', syncParam: 'group' } },
  children: [
    {
      type: 'Column',
      props: page,
      children: [
        {
          type: 'Row',
          props: { gap: '200', wrap: true },
          children: [
            {
              type: 'we-button',
              props: {
                variant: { $: "local.group == '' ? 'secondary' : 'ghost'" },
                size: 'sm',
                onClick: { $setLocal: 'group', value: '' },
              },
              children: ['All'],
            },
            {
              type: '$each',
              props: { items: [...GROUPS], as: 'g' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: { $: "local.group == g ? 'secondary' : 'ghost'" },
                    size: 'sm',
                    onClick: { $setLocal: 'group', value: { $: 'g' } },
                  },
                  children: [
                    { type: 'we-icon', props: { name: { $: `${GROUP_ICON}[g]` } } },
                    { type: 'we-text', props: { textTransform: 'capitalize' }, children: [{ $: 'g' }] },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'Grid',
          props: { minChildWidth: '220px', gap: '400', width: '100%' },
          children: [
            {
              type: '$each',
              props: { items: { $: "local.species.filter(s, local.group == '' || s.group == local.group)" }, as: 'sp' },
              children: [
                {
                  type: 'Column',
                  props: { bg: 'surface', r: 'surface', border: '1px solid border', overflow: 'hidden' },
                  children: [
                    {
                      type: 'we-image',
                      props: {
                        src: { $: 'sp.photo.src' },
                        alt: { $: 'sp.commonName' },
                        fit: 'cover',
                        height: '140px',
                        width: '100%',
                      },
                    },
                    {
                      type: 'Column',
                      props: { p: '400', gap: '200' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'heading-sm', tag: 'h3' },
                          children: [{ $: 'sp.commonName' }],
                        },
                        {
                          type: 'we-text',
                          props: { italic: true, color: 'text-muted' },
                          children: [{ $: 'sp.scientificName' }],
                        },
                        {
                          type: 'Row',
                          props: { gap: '200', ay: 'center', wrap: true },
                          children: [
                            { type: 'we-badge', props: { size: 'sm' }, children: [{ $: 'sp.group' }] },
                            {
                              type: 'we-badge',
                              props: {
                                size: 'sm',
                                variant: {
                                  $: "sp.status == 'rare' || sp.status == 'protected' ? 'warning' : 'neutral'",
                                },
                              },
                              children: [{ $: 'sp.status' }],
                            },
                          ],
                        },
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-muted' },
                          children: [
                            {
                              $: "`${count(local.sightings.filter(x, x.species == sp.id))} ${plural(count(local.sightings.filter(x, x.species == sp.id)), 'sighting', 'sightings')}`",
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export const sightingsSection: TemplateSchema & { id: string } = {
  id: 'field-guide-sightings',
  meta: {
    name: 'Sightings',
    description: 'What has been seen, newest first',
    icon: 'binoculars',
    role: 'view',
    segment: 'sightings',
  },
  type: 'Column',
  props: { width: '100%', ax: 'center' },
  $queries: {
    sightings: { entity: 'Sighting', include: { species: true, place: true }, order: { seenAt: 'desc' }, limit: 200 },
  },
  children: [
    {
      type: 'Column',
      props: { ...page, maxWidth: 'var(--we-layout-md)', gap: '300' },
      children: [
        {
          type: '$each',
          props: { items: { $: 'local.sightings' }, as: 's' },
          children: [
            {
              type: 'Row',
              props: { bg: 'surface', r: 'surface', border: '1px solid border', p: '400', gap: '400', ay: 'start' },
              children: [
                {
                  type: 'Column',
                  props: { width: '56px', minWidth: '56px', ax: 'center', gap: '100' },
                  children: [
                    { type: 'we-text', props: { variant: 'heading-md' }, children: [{ $: 's.count' }] },
                    { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['seen'] },
                  ],
                },
                {
                  type: 'Column',
                  props: { flex: '1', minWidth: '0', gap: '200' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '300', ay: 'center', wrap: true },
                      children: [
                        {
                          type: 'we-text',
                          props: { fontWeight: 'semibold' },
                          children: [{ $: 's.species.commonName' }],
                        },
                        {
                          type: 'we-badge',
                          props: {
                            size: 'sm',
                            variant: {
                              $: "s.certainty == 'certain' ? 'success' : s.certainty == 'likely' ? 'neutral' : 'warning'",
                            },
                          },
                          children: [{ $: 's.certainty' }],
                        },
                      ],
                    },
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        { type: 'we-icon', props: { name: 'map-pin', color: 'text-muted' } },
                        { type: 'we-text', props: { color: 'text-muted' }, children: [{ $: 's.place.name' }] },
                      ],
                    },
                    { type: 'we-text', children: [{ $: 's.notes' }] },
                    {
                      type: '$agent',
                      props: { did: { $: 's.author' }, as: 'by' },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '200', ay: 'center' },
                          children: [
                            {
                              type: 'we-avatar',
                              props: { size: 'xs', image: { $: 'by.avatar' }, hash: { $: 'by.did' } },
                            },
                            { type: 'we-text', props: { variant: 'footnote' }, children: [{ $: 'by.name' }] },
                            {
                              type: 'we-timestamp',
                              props: { value: { $: 's.seenAt' }, relative: true, color: 'text-muted' },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export const mapSection: TemplateSchema & { id: string } = {
  id: 'field-guide-map',
  meta: {
    name: 'Map',
    description: 'Where things have been seen',
    icon: 'map-trifold',
    role: 'view',
    segment: 'map',
    keepAlive: true,
  },
  type: 'Column',
  props: { width: '100%', height: '100%', minHeight: '70dvh' },
  $queries: {
    sightings: { entity: 'Sighting', include: { species: true, place: true }, limit: 500 },
  },
  children: [
    {
      type: 'CesiumGlobe',
      props: {
        backgroundLayers: [{ factory: 'proceduralStarsLayer', options: { count: 1500 } }],
        planetLayers: [
          {
            factory: 'pointLocationsLayer',
            id: 'sightings',
            options: {
              locations: {
                $: 'local.sightings.map(s, { id: s.id, name: s.title, latitude: s.place.latitude, longitude: s.place.longitude })',
              },
              markerSize: 18,
              defaultColor: '#2f9e6b',
            },
          },
          { factory: 'countryOutlinesLayer', options: { color: '#ffffff', opacity: 0.4, width: 1 } },
        ],
      },
    },
  ],
};
