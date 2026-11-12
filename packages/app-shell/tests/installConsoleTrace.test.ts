/**
 * Which trace scopes are on: the `we:trace` switch when it is set, else the build's default.
 *
 * `interpretation` is on by default in a development build and off in a production build, so an
 * auto-processor pass is a log line a developer sees without asking, and nothing in a shipped app.
 */
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

/**
 * The switch and the trace it installs into, loaded fresh: the default scopes are read from the
 * build mode when the module loads, so each case stubs the mode first.
 */
async function load() {
  vi.resetModules();
  const { installConsoleTrace } = await import('@shared/installConsoleTrace');
  const { setTraceSink, trace } = await import('@we/backend-shared');
  return { installConsoleTrace, setTraceSink, trace };
}

/** The trace lines the console sink printed. */
function lines(log: MockInstance<typeof console.log>): string[] {
  return log.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('we:trace '));
}

describe('installConsoleTrace', () => {
  let log: MockInstance<typeof console.log>;
  let reset: (() => void) | undefined;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    reset?.();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs interpretation, and only that, in a development build with the switch unset', async () => {
    vi.stubEnv('PROD', false);
    const { installConsoleTrace, setTraceSink, trace } = await load();
    reset = () => setTraceSink(null);

    expect(installConsoleTrace()).toBe(true);
    trace('interpretation', 'pass', { outcome: 'done', recordCount: 2 });
    trace('presence', 'send');

    const printed = lines(log);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatch(/interpretation pass\t\{"outcome":"done","recordCount":2\}$/);
  });

  it('logs nothing in a production build with the switch unset', async () => {
    vi.stubEnv('PROD', true);
    const { installConsoleTrace, setTraceSink, trace } = await load();
    reset = () => setTraceSink(null);

    expect(installConsoleTrace()).toBe(false);
    trace('interpretation', 'pass', { outcome: 'done' });
    expect(lines(log)).toEqual([]);
  });

  it('lets the switch replace the default', async () => {
    vi.stubEnv('PROD', false);
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'we:trace' ? 'none' : null) });
    const { installConsoleTrace, setTraceSink, trace } = await load();
    reset = () => setTraceSink(null);

    installConsoleTrace();
    trace('interpretation', 'pass', { outcome: 'done' });
    expect(lines(log)).toEqual([]);
  });
});
