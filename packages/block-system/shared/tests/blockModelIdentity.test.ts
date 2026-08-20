/**
 * Block registrations must answer the questions the persistence layer asks.
 *
 * This test used to pin the opposite of what it pins now: registrations HAD to be the AD4M
 * classes, because serialization read decorator metadata keyed by class identity, and an entity
 * stand-in resolved to no metadata at all — blocks persisted with empty data and posts came back
 * blank. That metadata now comes from the manifest, which is exactly what freed the registrations
 * to BE the stand-ins — so what is pinned instead is the new load-bearing pair: every registered
 * node type carries the entity name its manifest facts are looked up under, and the manifest
 * actually declares that entity with the fields a serialized node maps onto.
 */
import { CORE_MANIFEST } from '@we/models/manifest';
import { describe, expect, it } from 'vitest';

import { registerCoreBlocks } from '../src/core-blocks';
import { getBlockRegistration } from '../src/registry';

registerCoreBlocks();

describe('registered block models', () => {
  it.each(['image', 'paragraph', 'root', 'file', 'event'])('binds "%s" to a manifest entity', (nodeType) => {
    const registration = getBlockRegistration(nodeType);
    expect(registration, `no block registered for "${nodeType}"`).toBeDefined();

    const entity = CORE_MANIFEST.entities[registration!.entity];
    expect(
      entity,
      `"${nodeType}" names entity "${registration!.entity}", which the manifest does not declare`,
    ).toBeDefined();
    expect(
      Object.keys(entity.properties).length,
      `"${registration!.entity}" declares no properties — nothing a serialized node could map onto`,
    ).toBeGreaterThan(0);
  });

  it('carries the property a serialized node actually maps onto', () => {
    // Spot-check one binding end to end rather than trusting the count alone.
    const registration = getBlockRegistration('image')!;
    expect(Object.keys(CORE_MANIFEST.entities[registration.entity].properties)).toContain('src');
  });

  it('declares the file-storage fields the upload path depends on', () => {
    // preUploadFileAssets keys off format:'file' in the manifest; if ImageBlock.src lost that
    // marker, uploads would silently stop being stored out-of-band.
    const registration = getBlockRegistration('image')!;
    expect(CORE_MANIFEST.entities[registration.entity].properties.src.format).toBe('file');
  });
});
