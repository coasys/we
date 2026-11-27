/**
 * The platform port in a browser — the one every app that renders into a web page supplies (the web
 * host, and the Electron and Tauri windows, which are browsers too).
 *
 * The one place outside `frameworks/` the stores' environment touches the window's globals.
 */
import { canvasImageCodec } from '@we/entities';

import type { PlatformDocument, PlatformEvents, PlatformPort, PlatformStorage } from './port';

/**
 * A browser storage, or a map standing in for it where the browser refuses one (storage blocked by
 * the person's settings, a sandboxed frame): a write that cannot be kept is lost with the page,
 * rather than throwing into whatever wrote it.
 */
function browserStorage(pick: () => Storage): PlatformStorage {
  const fallback = new Map<string, string>();
  const storage = (): Storage | null => {
    try {
      return pick();
    } catch {
      return null;
    }
  };
  return {
    getItem: (key) => {
      try {
        return storage()?.getItem(key) ?? fallback.get(key) ?? null;
      } catch {
        return fallback.get(key) ?? null;
      }
    },
    setItem: (key, value) => {
      try {
        const s = storage();
        if (s) return s.setItem(key, value);
      } catch {
        // Full or refused: kept for this page instead.
      }
      fallback.set(key, value);
    },
    removeItem: (key) => {
      fallback.delete(key);
      try {
        storage()?.removeItem(key);
      } catch {
        // Nothing kept there to remove.
      }
    },
  };
}

function browserDocument(): PlatformDocument {
  const root = () => document.documentElement;
  const iconLink = () => document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  return {
    setRootProperty: (name, value) => {
      if (value === null) root().style.removeProperty(name);
      else root().style.setProperty(name, value);
    },
    setRootAttribute: (name, value) => {
      if (value === null) root().removeAttribute(name);
      else root().setAttribute(name, value);
    },
    root,
    setStyleSheet: (id, css) => {
      let element = document.getElementById(id) as HTMLStyleElement | null;
      if (!element) {
        element = document.createElement('style');
        element.id = id;
        document.head.appendChild(element);
      }
      element.textContent = css;
    },
    readComputedStyle: (read, properties) => {
      if (!properties) return read(getComputedStyle(root()));
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
      for (const [name, value] of Object.entries(properties)) probe.style.setProperty(name, value);
      document.body.appendChild(probe);
      try {
        return read(getComputedStyle(probe));
      } finally {
        probe.remove();
      }
    },
    byId: (id) => document.getElementById(id),
    queryAll: (selector) => [...document.querySelectorAll(selector)],
    measure: (selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
    },
    escape: (value) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value),
    title: () => document.title,
    setTitle: (title) => {
      document.title = title;
    },
    iconHref: () => iconLink()?.getAttribute('href') ?? null,
    setIconHref: (href) => iconLink()?.setAttribute('href', href),
  };
}

export function createBrowserPlatform(): PlatformPort {
  return {
    storage: browserStorage(() => window.localStorage),
    sessionStorage: browserStorage(() => window.sessionStorage),
    location: () => {
      const { pathname, search, hash, origin, protocol } = window.location;
      return { pathname, search, hash, origin, protocol };
    },
    history: {
      push: (url) => window.history.pushState(null, '', url),
      replace: (url) => window.history.replaceState(null, '', url),
      back: () => window.history.back(),
    },
    reload: () => window.location.reload(),
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    matchMedia: (query) => {
      const list = typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
      return {
        matches: () => list?.matches ?? false,
        onChange: (listener) => {
          if (!list) return () => {};
          const onChange = (event: MediaQueryListEvent) => listener(event.matches);
          list.addEventListener('change', onChange);
          return () => list.removeEventListener('change', onChange);
        },
      };
    },
    listen: <K extends keyof PlatformEvents>(
      type: K,
      listener: (event: PlatformEvents[K]) => void,
      options?: { capture?: boolean },
    ) => {
      const capture = options?.capture ?? false;
      const handler = listener as EventListener;
      window.addEventListener(type, handler, capture);
      return () => window.removeEventListener(type, handler, capture);
    },
    // A picture drawn on a canvas at its new size and read back as PNG.
    images: canvasImageCodec,
    frame: (callback) => {
      if (typeof window.requestAnimationFrame !== 'function') {
        const timer = setTimeout(callback, 16);
        return () => clearTimeout(timer);
      }
      const handle = window.requestAnimationFrame(callback);
      return () => window.cancelAnimationFrame(handle);
    },
    document: browserDocument(),
  };
}
