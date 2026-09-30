/*
  Browser APIs jsdom does not implement, for the Solid tests that render real components.

  Not a mock of anything the tests assert about: these are observers whose whole purpose is to
  report a layout jsdom never performs, so a no-op is the honest stand-in — every box is 0x0 there
  whether or not anything watches it. What the absence actually does is throw during mount, which
  takes down a test about something else entirely.

  `ResizeObserver` is the one that bit: the thread's reply composer is inline now, so every test
  that renders a discussion mounts a real ProseMirror editor, and its block handles watch the
  editor for resizes. Three thread tests failed on a constructor, none of them about composing.

  Anything that genuinely needs measurement belongs in `tests/browser`, which runs in a browser.
*/
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
  if (!(name in globalThis)) {
    (globalThis as unknown as Record<string, unknown>)[name] = NoopObserver;
  }
}
