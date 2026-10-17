/**
 * The host's call services — which dataset a call is in, and what happens without a call port.
 *
 * What the port does with a dataset is tested beside the port (`@we/backend-ad4m`'s `callPort`).
 */
import { createCallServices } from '@shared/callServices';
import type { CallPort, DatasetHandle } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

const onScreen = { name: 'on screen' } as unknown as DatasetHandle;
const callSpace = { name: 'call space' } as unknown as DatasetHandle;

function fakePort(): CallPort & { [K in keyof CallPort]: ReturnType<typeof vi.fn> } {
  return {
    createSession: vi.fn().mockResolvedValue({ session: true }),
    config: vi.fn().mockResolvedValue({ mode: 'designated' }),
    setConfig: vi.fn().mockResolvedValue(true),
    configurable: vi.fn().mockReturnValue(true),
  };
}

function services(over: { port?: CallPort | undefined; current?: DatasetHandle | null } = {}) {
  const port = 'port' in over ? over.port : fakePort();
  return createCallServices({
    port: () => port,
    current: () => ('current' in over ? (over.current ?? null) : onScreen),
    byUri: (uri) => (uri === 'neighbourhood://call-space' ? callSpace : null),
  });
}

describe('a session', () => {
  it('is built in the space on screen when the call names none', async () => {
    const port = fakePort();

    const session = await services({ port }).createCallBackend('call-1', { topology: 'sfu' });

    expect(session).toEqual({ session: true });
    expect(port.createSession).toHaveBeenCalledWith(onScreen, 'call-1', { topology: 'sfu' });
  });

  /*
    A participant following a topology switch reconnects wherever they are looking, which need not
    be the call's space. Built in the space on screen, the new session was a call nobody was in.
  */
  it('is built in the call’s own space, not the one on screen', async () => {
    const port = fakePort();

    await services({ port }).createCallBackend('call-1', {
      topology: 'mesh',
      datasetUri: 'neighbourhood://call-space',
    });

    expect(port.createSession).toHaveBeenCalledWith(callSpace, 'call-1', { topology: 'mesh' });
  });

  it('is refused rather than built in the space on screen when the call’s is not joined', async () => {
    const port = fakePort();

    await expect(
      services({ port }).createCallBackend('call-1', { datasetUri: 'neighbourhood://gone' }),
    ).rejects.toThrow(/not joined/);
    expect(port.createSession).not.toHaveBeenCalled();
  });

  it('passes the ICE servers through, and not the space’s uri', async () => {
    const port = fakePort();
    const iceServers = [{ urls: 'stun:a.example.org' }];

    await services({ port }).createCallBackend('call-1', { iceServers, datasetUri: 'neighbourhood://call-space' });

    expect(port.createSession).toHaveBeenCalledWith(callSpace, 'call-1', { iceServers });
  });

  it('throws when no dataset is open', async () => {
    await expect(services({ current: null }).createCallBackend('call-x')).rejects.toThrow('no active dataset');
  });

  it('throws when the backend has no call port', async () => {
    await expect(services({ port: undefined }).createCallBackend('call-x')).rejects.toThrow('cannot run calls');
  });

  it('reads the port when asked, not when built — the backend connects later', async () => {
    let port: CallPort | undefined;
    const later = createCallServices({ port: () => port, current: () => onScreen, byUri: () => null });
    port = fakePort();

    await later.createCallBackend('call-1');

    expect(port.createSession).toHaveBeenCalled();
  });
});

describe('the policy', () => {
  it('is read and written for the space on screen', async () => {
    const port = fakePort();
    const call = services({ port });

    expect(await call.getCallConfig()).toEqual({ mode: 'designated' });
    expect(await call.setCallConfig({ mode: 'mesh' })).toBe(true);

    expect(port.config).toHaveBeenCalledWith(onScreen);
    expect(port.setConfig).toHaveBeenCalledWith(onScreen, { mode: 'mesh' });
  });

  it('is configurable only where the port says so', () => {
    const port = fakePort();
    port.configurable.mockReturnValue(false);

    expect(services({ port }).callConfigSupported()).toBe(false);
    expect(services().callConfigSupported()).toBe(true);
  });

  it('has nothing to configure with no dataset open or no call port', () => {
    expect(services({ current: null }).callConfigSupported()).toBe(false);
    expect(services({ port: undefined }).callConfigSupported()).toBe(false);
  });

  it('refuses a read with no dataset open', async () => {
    await expect(services({ current: null }).getCallConfig()).rejects.toThrow('no active dataset');
  });
});
