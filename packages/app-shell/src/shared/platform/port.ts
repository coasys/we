/**
 * What a store reaches of the place it runs: storage, the address, the window's size and media
 * queries, its input events, animation frames and the drawn document.
 *
 * The stores are written against `@we/reactivity` so another framework can host them; this is the
 * same seam for the environment. Every member is what some store under `shared/stores/` actually
 * uses, and nothing more: a store reads `platform.storage`, never `localStorage`, so one runs in a
 * browser, under a test with no DOM, or on a host that draws nothing, given an implementation of
 * this. `pnpm check:neutral-stores` refuses a browser global under `shared/stores/`.
 *
 * It is the environment half of {@link PlatformAdapter}, which extends it: the adapter an app
 * supplies says where the app is running, and a browser renderer (web, Electron, Tauri) answers
 * these with {@link createBrowserPlatform}. Timers and `performance.now()` are not here: every
 * JavaScript runtime has them, and a test controls them with its runner's fake clock.
 */

/** A string store by key, as `localStorage` is. Reads of a key never written answer null. */
export interface PlatformStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Where the app is, as the address bar says it. `search` and `hash` keep their `?` and `#`. */
export interface PlatformAddress {
  pathname: string;
  search: string;
  hash: string;
  /** `https://we.example`; the text `null` where the app is not served over a network (a file). */
  origin: string;
  /** `https:`, `file:`, a host's own scheme. */
  protocol: string;
}

/** A media query, followed. */
export interface PlatformMediaQuery {
  matches(): boolean;
  /** Called with whether it matches each time that changes. Returns its own removal. */
  onChange(listener: (matches: boolean) => void): () => void;
}

/** The window's input events the stores listen for, and what each carries. */
export interface PlatformEvents {
  resize: Event;
  popstate: PopStateEvent;
  keydown: KeyboardEvent;
  pointermove: PointerEvent;
  pointerup: PointerEvent;
  pointercancel: PointerEvent;
}

/** A box on screen, in viewport pixels. */
export interface PlatformRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The document the app is drawn into: what the stores publish on its root, find in it and measure.
 *
 * Where nothing is drawn every lookup answers null and every write is kept by the implementation
 * (the test one records them), so a store needs no "is there a document" branch of its own.
 */
export interface PlatformDocument {
  /**
   * Set a custom property on the document's root, or remove it with null — the chrome insets and
   * transitions chrome outside the stores' arithmetic reads (`--we-chrome-left`).
   */
  setRootProperty(name: string, value: string | null): void;
  /** Set an attribute on the document's root, or remove it with null (`data-we-theme`). */
  setRootAttribute(name: string, value: string | null): void;
  /** The root element itself, for a theme's variables, which are written and read as a set. */
  root(): HTMLElement | null;
  /** The text of a `<style>` element by id in the document's head, made when it is missing. */
  setStyleSheet(id: string, css: string): void;
  /**
   * Read the computed style of the root, or of a hidden element wearing `properties` when given:
   * what a theme's settings come back as. `read` runs while the element is in the document.
   */
  readComputedStyle<T>(read: (style: CSSStyleDeclaration) => T, properties?: Record<string, string>): T | null;
  /** The element with this id, or null. */
  byId(id: string): HTMLElement | null;
  /** Every element matching a CSS selector. */
  queryAll(selector: string): Element[];
  /** The box the first element matching a CSS selector is drawn in, or null when none is. */
  measure(selector: string): PlatformRect | null;
  /** A value written so a selector matches it exactly, as `CSS.escape`. */
  escape(value: string): string;
  /** The window's title. */
  title(): string;
  setTitle(title: string): void;
  /** The address of the window's icon, or null when the page declares none. */
  iconHref(): string | null;
  setIconHref(href: string): void;
}

export interface PlatformPort {
  /** Kept on this device across sessions. */
  storage: PlatformStorage;
  /** Kept for this window's session only (a tab, until it closes). */
  sessionStorage: PlatformStorage;
  /** The address the app is at now. */
  location(): PlatformAddress;
  /** The window's history, by path-and-query URL. */
  history: {
    push(url: string): void;
    replace(url: string): void;
    back(): void;
  };
  /** Load the app again from the start. */
  reload(): void;
  /** The window's size, in CSS pixels. */
  viewport(): { width: number; height: number };
  /** A media query (`(prefers-color-scheme: dark)`), followed while the app runs. */
  matchMedia(query: string): PlatformMediaQuery;
  /**
   * Listen for one of the window's events; `capture` hears it before anything in the page does.
   * Returns its own removal.
   */
  listen<K extends keyof PlatformEvents>(
    type: K,
    listener: (event: PlatformEvents[K]) => void,
    options?: { capture?: boolean },
  ): () => void;
  /** Call `callback` before the next frame is painted. Returns a cancel. */
  frame(callback: () => void): () => void;
  document: PlatformDocument;
}
