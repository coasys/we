/**
 * Which app's name, mark and sign-in screen are showing.
 *
 * WE goes by its own unless the app in use came in a bundle that brings a brand — then the bundle's
 * stands in for WE's wherever the app names itself. Pure, so the rule can be stated and tested
 * without an app; `TemplateStore` reads the signals and passes them in.
 *
 * ## The rule
 *
 * 1. **Safe mode draws WE's**, whatever anything says. An app that hides every way out is never the
 *    only way in, and the same goes for its sign-in screen.
 * 2. **Once the agent's settings are known**, the app in use decides: the bundle it came from, if any.
 * 3. **Before that** — on the sign-in screen, and for the moment after — the device's memory of the
 *    app it last ran (`deviceApp.ts`), and failing that the deployment's own app (the seed's).
 */
import type { ThemeData } from '@we/entities';
import type { BundleBrand, SchemaNode } from '@we/schema-shared';

import type { DeviceApp } from './deviceApp';

/** What the shell shows of an app before and around everything else. */
export interface AppFace {
  /** The bundle it came from; `''` for WE's own. */
  bundleId: string;
  brand?: BundleBrand;
  bootScreen?: SchemaNode;
}

/** Where a bundle's face can come from: one built in, or one an agent installed. */
export interface FaceSource {
  bundleId: string;
  brand?: BundleBrand;
  bootScreen?: SchemaNode;
}

export interface FaceInput {
  safe: boolean;
  /** Whether the agent's settings have been read — before that, the app in use is a guess. */
  settled: boolean;
  /** The bundle the app in use came from (`appTemplate().source.bundle`), or undefined for WE's own. */
  inUseBundle: string | undefined;
  /** Every bundle that could be in use: the seed's, then the agent's installed ones. */
  sources: readonly FaceSource[];
  device: DeviceApp | null;
}

const WE: AppFace = { bundleId: '' };

export function resolveFace(input: FaceInput): AppFace {
  if (input.safe) return WE;
  if (!input.settled && input.device) {
    /*
      The device says which app it last ran; the build, where it carries that bundle, says what the
      app looks like now. The device's copy is from the last session, so taken whole it drew an old
      mark at sign-in after the app's own had changed — Coasys's placeholder hexagon after its logo
      arrived. Only a bundle the build does not carry falls back to it.
    */
    const fresh = input.sources.find((candidate) => candidate.bundleId === input.device!.bundleId);
    const { bundleId, brand, bootScreen } = fresh ?? input.device;
    return { bundleId, ...(brand ? { brand } : {}), ...(bootScreen ? { bootScreen } : {}) };
  }
  if (!input.inUseBundle) return WE;
  const source = input.sources.find((candidate) => candidate.bundleId === input.inUseBundle);
  if (!source) return WE;
  return {
    bundleId: source.bundleId,
    ...(source.brand ? { brand: source.brand } : {}),
    ...(source.bootScreen ? { bootScreen: source.bootScreen } : {}),
  };
}

/** What the device keeps of a face, for the next boot. */
export function deviceAppOf(face: AppFace, themes: readonly ThemeData[]): Omit<DeviceApp, 'v'> {
  return {
    bundleId: face.bundleId,
    ...(face.brand ? { brand: face.brand } : {}),
    ...(face.bootScreen ? { bootScreen: face.bootScreen } : {}),
    ...(themes.length ? { themes: [...themes] } : {}),
  };
}

/** An SVG as a URL an `<img>` (and so `we-image`, and a favicon) can draw. */
export function svgDataUrl(svg: string | undefined): string {
  if (!svg) return '';
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/** The name WE goes by when no app in use brings its own. */
export const WE_PRODUCT_NAME = 'WE';

/*
  The product's name, for code that is not a template — a toast, the failure screen — and so cannot
  read `templateStore.brand`. Set by `TemplateStore` whenever the face changes; WE's until then, which
  is also the right answer for a failure before the stores exist.
*/
let productName = WE_PRODUCT_NAME;

export function currentProductName(): string {
  return productName;
}

export function setCurrentProductName(name: string | undefined): void {
  productName = name?.trim() || WE_PRODUCT_NAME;
}
