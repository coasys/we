/**
 * The platform port with nothing behind it: storage in maps, an address and a history held in
 * memory, a window whose size a test sets, events a test sends, frames a test runs, and a document
 * that keeps what is written to its root, and draws only the elements and frames a test says it does.
 *
 * What the store tests take in place of a browser, so a store runs with no DOM at all and a test
 * says what the window does rather than hoping jsdom does it.
 */
import type { ThemeOverrides } from '@we/schema-shared';

import type { PlatformAddress, PlatformEvents, PlatformPort, PlatformRect, PlatformStorage } from './port';

/** A storage in a map, readable as one. */
export interface TestStorage extends PlatformStorage {
  readonly entries: Map<string, string>;
}

function testStorage(): TestStorage {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, String(value)),
    removeItem: (key) => void entries.delete(key),
  };
}

export interface TestPlatformOptions {
  /** Where the app starts: a path with its query and hash. Default `/`. */
  url?: string;
  /** Default `http://we.test`. */
  origin?: string;
  /** Default 1440 × 900. */
  viewport?: { width: number; height: number };
  /** The media queries that match, by their text. */
  media?: Record<string, boolean>;
}

export interface TestPlatform extends PlatformPort {
  storage: TestStorage;
  sessionStorage: TestStorage;
  /** Every URL the history has held, oldest first, and where in it the app is. */
  readonly entries: string[];
  index(): number;
  /** Move the address as a person would by typing or following a link elsewhere: no history entry, no event. */
  setUrl(url: string): void;
  /** The browser's back button: the previous entry, and a `popstate`. */
  goBack(): void;
  /** Resize the window, and send `resize`. */
  resize(size: { width: number; height: number }): void;
  /** Change whether a media query matches, and tell its listeners. */
  setMedia(query: string, matches: boolean): void;
  /** Send one of the window's events to whatever listens for it. Captured listeners hear it first. */
  emit<K extends keyof PlatformEvents>(type: K, event: PlatformEvents[K]): void;
  /** How many listeners there are for an event. */
  listeners(type: keyof PlatformEvents): number;
  /** Run the frame callbacks asked for so far; ones asked for while they run wait for the next call. */
  flushFrames(): void;
  /** How many times the app asked to be loaded again. */
  reloads(): number;
  /** What was written to the document's root, its style sheets and its title. */
  readonly drawn: {
    properties: Map<string, string>;
    attributes: Map<string, string>;
    styleSheets: Map<string, string>;
    title: string;
    iconHref: string | null;
  };
  /** Say where an element matching a selector is drawn, for `document.measure`. */
  setMeasured(selector: string, rect: PlatformRect | null): void;
  /** Say whether an element with this id is drawn, for `document.reveal`. */
  setDrawnId(id: string, drawn: boolean): void;
  /** Say which origins the embedded frames show, one entry per frame, for `document.postToFrames`. */
  setFrames(origins: readonly string[]): void;
  /** Every theme written to the root, every element brought into view, every message posted to a frame. */
  readonly asked: {
    themes: { theme: ThemeOverrides; crossFade?: boolean }[];
    revealed: { id: string; block?: string }[];
    posted: { message: unknown; origin: string }[];
  };
}

export function createTestPlatform(options: TestPlatformOptions = {}): TestPlatform {
  const origin = options.origin ?? 'http://we.test';
  const entries = [options.url ?? '/'];
  let index = 0;
  let size = options.viewport ?? { width: 1440, height: 900 };
  const media = new Map(Object.entries(options.media ?? {}));
  const mediaListeners = new Map<string, Set<(matches: boolean) => void>>();
  const listeners = new Map<string, { listener: (event: never) => void; capture: boolean }[]>();
  let frames: (() => void)[] = [];
  let reloads = 0;
  const measured = new Map<string, PlatformRect | null>();
  const drawnIds = new Set<string>();
  let frameOrigins: readonly string[] = [];
  const asked: TestPlatform['asked'] = { themes: [], revealed: [], posted: [] };
  const drawn: TestPlatform['drawn'] = {
    properties: new Map(),
    attributes: new Map(),
    styleSheets: new Map(),
    title: '',
    iconHref: null,
  };

  const address = (): PlatformAddress => {
    const url = new URL(entries[index], origin);
    return { pathname: url.pathname, search: url.search, hash: url.hash, origin: url.origin, protocol: url.protocol };
  };
  const emit = <K extends keyof PlatformEvents>(type: K, event: PlatformEvents[K]) => {
    const all = [...(listeners.get(type) ?? [])];
    for (const entry of [...all.filter((l) => l.capture), ...all.filter((l) => !l.capture)])
      (entry.listener as (event: PlatformEvents[K]) => void)(event);
  };

  return {
    storage: testStorage(),
    sessionStorage: testStorage(),
    location: address,
    history: {
      push: (url) => {
        entries.splice(index + 1, entries.length, url);
        index = entries.length - 1;
      },
      replace: (url) => {
        entries[index] = url;
      },
      back: () => {
        if (index === 0) return;
        index -= 1;
        emit('popstate', { state: null } as PopStateEvent);
      },
    },
    reload: () => {
      reloads += 1;
    },
    viewport: () => size,
    matchMedia: (query) => ({
      matches: () => media.get(query) ?? false,
      onChange: (listener) => {
        const set = mediaListeners.get(query) ?? new Set();
        mediaListeners.set(query, set);
        set.add(listener);
        return () => set.delete(listener);
      },
    }),
    listen: (type, listener, opts) => {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list);
      const entry = { listener: listener as (event: never) => void, capture: opts?.capture ?? false };
      list.push(entry);
      return () => {
        const at = list.indexOf(entry);
        if (at >= 0) list.splice(at, 1);
      };
    },
    /*
      A host with no renderer stores a picture as it came: the bytes untouched, labelled PNG as the
      browser's codec labels what it draws. What a store does around the encoding — what it uploads,
      what it shows — is then the same as in a browser.
    */
    images: { resize: async (image) => new Blob([await image.arrayBuffer()], { type: 'image/png' }) },
    frame: (callback) => {
      frames.push(callback);
      return () => {
        frames = frames.filter((f) => f !== callback);
      };
    },
    document: {
      setRootProperty: (name, value) => {
        if (value === null) drawn.properties.delete(name);
        else drawn.properties.set(name, value);
      },
      setRootAttribute: (name, value) => {
        if (value === null) drawn.attributes.delete(name);
        else drawn.attributes.set(name, value);
      },
      applyTheme: (theme, opts) => void asked.themes.push({ theme, ...(opts ?? {}) }),
      setStyleSheet: (id, css) => void drawn.styleSheets.set(id, css),
      readComputedStyle: () => null,
      reveal: (id, opts) => {
        if (!drawnIds.has(id)) return false;
        asked.revealed.push({ id, ...(opts?.block ? { block: opts.block } : {}) });
        return true;
      },
      postToFrames: (message, origins) => {
        let sent = 0;
        for (const origin of frameOrigins) {
          if (!origins.includes(origin)) continue;
          asked.posted.push({ message, origin });
          sent++;
        }
        return sent;
      },
      measure: (selector) => measured.get(selector) ?? null,
      escape: (value) => value.replace(/["\\]/g, '\\$&'),
      title: () => drawn.title,
      setTitle: (title) => {
        drawn.title = title;
      },
      iconHref: () => drawn.iconHref,
      setIconHref: (href) => {
        drawn.iconHref = href;
      },
    },

    entries,
    index: () => index,
    setUrl: (url) => {
      entries[index] = url;
    },
    goBack: () => {
      if (index === 0) return;
      index -= 1;
      emit('popstate', { state: null } as PopStateEvent);
    },
    resize: (next) => {
      size = next;
      emit('resize', {} as Event);
    },
    setMedia: (query, matches) => {
      media.set(query, matches);
      for (const listener of mediaListeners.get(query) ?? []) listener(matches);
    },
    emit,
    listeners: (type) => listeners.get(type)?.length ?? 0,
    flushFrames: () => {
      const due = frames;
      frames = [];
      for (const callback of due) callback();
    },
    reloads: () => reloads,
    drawn,
    setMeasured: (selector, rect) => void measured.set(selector, rect),
    setDrawnId: (id, isDrawn) => void (isDrawn ? drawnIds.add(id) : drawnIds.delete(id)),
    setFrames: (origins) => {
      frameOrigins = [...origins];
    },
    asked,
  };
}
