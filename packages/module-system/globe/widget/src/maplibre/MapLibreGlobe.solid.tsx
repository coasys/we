/**
 * The light globe: MapLibre on its globe projection, drawing the same layers as `CesiumGlobe` from the
 * same props.
 *
 * For phones and lighter builds. It draws the earth and the data on it: imagery, markers, lines,
 * shaded and raised shapes. It does not draw the space around the earth (no skybox, stars or planets),
 * and lines lie flat on the ground rather than arcing — a template's layers that need either are
 * absent here, said once, rather than broken. Which globe a person gets is the host's decision, from
 * the globe module's `engine` setting; no template names an engine.
 *
 * Imported from `@we/globe-widget/maplibre`, an entry of its own, so a MapLibre build never loads
 * Cesium.
 */
import 'maplibre-gl/dist/maplibre-gl.css';

import { EventBus, LayerSet } from '@we/globe-core';
import type { MapLibreRendererContext } from '@we/globe-protocol';
import { type LayerSpecification, Map as MapLibreMap, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';

import type {} from '../cesium-env';
import type { CesiumGlobeProps, ImageryChoice } from '../CesiumGlobe.types';
import { baseSource, detailSources, registerImageryProtocols } from './imagery';

// MapLibre finds its worker beside its own file, which a bundle moves; this is the copy Vite built.
setWorkerUrl(maplibreWorker);

/** The same props as `CesiumGlobe`: a template places either the same way, and never chooses. */
export type MapLibreGlobeProps = CesiumGlobeProps;

/** The space behind the earth: plain dark, where Cesium draws stars. */
const SPACE = '#000005';

function initialStyle(): StyleSpecification {
  const base = baseSource();
  const layers: LayerSpecification[] = [{ id: 'space', type: 'background', paint: { 'background-color': SPACE } }];
  if (base) layers.push({ id: 'imagery-base', type: 'raster', source: 'imagery-base' });
  return {
    version: 8,
    projection: { type: 'globe' },
    sources: base ? { 'imagery-base': base } : {},
    layers,
    // A thin atmosphere at the limb, as Cesium draws one; fully faded once close to the ground.
    sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
  };
}

export function MapLibreGlobe(props: MapLibreGlobeProps) {
  let containerRef: HTMLDivElement | undefined;
  let map: MapLibreMap | undefined;
  let planet: LayerSet<MapLibreRendererContext> | undefined;
  let background: LayerSet<MapLibreRendererContext> | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const [ready, setReady] = createSignal(false);

  onMount(() => {
    if (!containerRef) return;
    registerImageryProtocols();
    map = new MapLibreMap({
      container: containerRef,
      style: initialStyle(),
      center: [0, 20],
      zoom: 1.4,
      attributionControl: { compact: true },
      // A globe is turned, not rotated about its axis like a road map.
      dragRotate: false,
    });
    // A tile that cannot be fetched (offline, or past what a source serves) shows the one beneath; it
    // is not worth a console line each.
    map.on('error', (event) => {
      const message = String((event.error as Error | undefined)?.message ?? '');
      if (!/tile|fetch|Failed to load|answered/i.test(message)) console.error('[globe]', event.error);
    });
    resizeObserver = new ResizeObserver(() => map?.resize());
    resizeObserver.observe(containerRef);

    const loaded = map;
    map.on('load', () => {
      const events = new EventBus();
      const layers = () =>
        new LayerSet<MapLibreRendererContext>({
          engine: 'maplibre',
          kinds: () => props.layerKinds,
          context: (shared) => ({ ...shared, map: loaded }),
          events,
        });
      planet = layers();
      background = layers();
      setReady(true);
    });
  });

  /** Compared by content, as on Cesium: the host rebuilds the choice whenever settings re-emit. */
  const suppliedImagery = createMemo<ImageryChoice | undefined>(() => props.imagery, undefined, {
    equals: (a, b) => a?.provider === b?.provider && a?.key === b?.key,
  });
  const [refusedKey, setRefusedKey] = createSignal<string>();
  const imageryChoice = createMemo<ImageryChoice | undefined>(
    () => {
      const choice = suppliedImagery();
      return choice && choice.key !== refusedKey() ? choice : undefined;
    },
    undefined,
    { equals: (a, b) => a?.provider === b?.provider && a?.key === b?.key },
  );

  /** Bumped when the network comes back, so imagery that failed offline is asked for again. */
  const [onlineEpoch, setOnlineEpoch] = createSignal(0);
  const onOnline = () => {
    setRefusedKey(undefined);
    setOnlineEpoch((n) => n + 1);
  };
  window.addEventListener('online', onOnline);
  onCleanup(() => window.removeEventListener('online', onOnline));

  /** The imagery sources above the base that this globe added, replaced as a whole. */
  let detail: string[] = [];
  let generation = 0;
  createEffect(() => {
    onlineEpoch();
    const choice = imageryChoice();
    if (!ready() || !map) return;
    const current = ++generation;
    const target = map;
    void detailSources(choice, () => setRefusedKey(choice?.key)).then((sources) => {
      if (current !== generation || target !== map) return;
      // Beneath every layer a template added: directly above the base.
      const beneath = target
        .getStyle()
        .layers.find((layer) => !layer.id.startsWith('imagery-') && layer.id !== 'space')?.id;
      const previous = detail;
      detail = [];
      for (const { id, source, minzoom } of sources) {
        const name = `${id}:${current}`;
        target.addSource(name, source);
        target.addLayer(
          { id: name, type: 'raster', source: name, ...(minzoom !== undefined ? { minzoom } : {}) },
          beneath,
        );
        detail.push(name);
      }
      // The old imagery goes once the new is in place; Natural Earth II stays beneath throughout.
      for (const name of previous) {
        if (target.getLayer(name)) target.removeLayer(name);
        if (target.getSource(name)) target.removeSource(name);
      }
    });
  });

  createEffect(() => {
    if (!ready()) return;
    background?.sync(props.backgroundLayers);
  });
  createEffect(() => {
    if (!ready()) return;
    planet?.sync(props.planetLayers);
  });

  onCleanup(() => {
    planet?.dispose();
    background?.dispose();
    resizeObserver?.disconnect();
    map?.remove();
    map = undefined;
  });

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        'min-width': '200px',
        'min-height': '200px',
        // role-audit: palette — space behind the earth, the same in every theme, as Cesium's is.
        background: SPACE,
      }}
    />
  );
}
