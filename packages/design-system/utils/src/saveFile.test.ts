/**
 * What a save reports, per path — the reason this exists is that the old download reported success
 * before the reader had chosen anywhere, including when they then cancelled.
 *
 * Node has no DOM, so the plain-download path is exercised with a stand-in `document`; the other two
 * are globals the helper feature-detects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataUriToBlob, provideFileSaver, saveFile } from './saveFile';

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.showSaveFilePicker;
  delete g.document;
  vi.restoreAllMocks();
});

describe('with the host’s own dialog', () => {
  let release: () => void;
  afterEach(() => release());

  it('says saved only when the host wrote it, and cancelled when it did not', async () => {
    const saver = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    release = provideFileSaver(saver);

    expect(await saveFile({ name: 'a.txt', type: 'text/plain', content: 'hi' })).toBe('saved');
    expect(new TextDecoder().decode(saver.mock.calls[0][0].bytes)).toBe('hi');
    expect(await saveFile({ name: 'a.txt', type: 'text/plain', content: 'hi' })).toBe('cancelled');
  });

  it('asks nothing of the host when there is nothing to write', async () => {
    const saver = vi.fn();
    release = provideFileSaver(saver);
    expect(await saveFile({ name: 'a.txt', type: 'text/plain', content: async () => null })).toBe('empty');
    expect(saver).not.toHaveBeenCalled();
  });
});

describe('with the browser’s save picker', () => {
  const written: Blob[] = [];
  let order: string[];

  beforeEach(() => {
    written.length = 0;
    order = [];
  });

  const handle = (remove = vi.fn(async () => undefined)) => ({
    remove,
    createWritable: async () => ({
      write: async (blob: Blob) => void written.push(blob),
      close: async () => undefined,
    }),
  });

  it('opens the picker before producing the content, so the click is still live', async () => {
    g.showSaveFilePicker = vi.fn(async () => {
      order.push('picker');
      return handle();
    });
    const outcome = await saveFile({
      name: 'log.md',
      type: 'text/markdown;charset=utf-8',
      content: async () => {
        order.push('content');
        return '# log';
      },
    });

    expect(outcome).toBe('saved');
    expect(order).toEqual(['picker', 'content']);
    expect(await written[0].text()).toBe('# log');
    expect(g.showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'log.md',
      types: [{ accept: { 'text/markdown': ['.md'] } }],
    });
  });

  it('reports a dismissed dialog as cancelled and produces nothing', async () => {
    g.showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    });
    const content = vi.fn(async () => 'never');
    expect(await saveFile({ name: 'a.txt', type: 'text/plain', content })).toBe('cancelled');
    expect(content).not.toHaveBeenCalled();
  });

  it('takes back the file when the content turns out empty', async () => {
    const remove = vi.fn(async () => undefined);
    g.showSaveFilePicker = vi.fn(async () => handle(remove));
    expect(await saveFile({ name: 'a.txt', type: 'text/plain', content: async () => null })).toBe('empty');
    expect(remove).toHaveBeenCalled();
  });

  it('falls back to a download when the picker is refused rather than cancelled', async () => {
    g.showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('Must be handling a user gesture.', 'SecurityError');
    });
    const click = vi.fn();
    g.document = {
      createElement: () => ({ click }),
      body: { appendChild: () => undefined, removeChild: () => undefined },
    };
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    expect(await saveFile({ name: 'a.txt', type: 'text/plain', content: 'hi' })).toBe('downloaded');
    expect(click).toHaveBeenCalled();
  });
});

describe('a data URI', () => {
  it('decodes base64 and percent-encoded bodies alike', async () => {
    expect(await dataUriToBlob('data:text/plain;base64,aGk=').text()).toBe('hi');
    expect(await dataUriToBlob('data:text/plain,a%20b').text()).toBe('a b');
    expect(dataUriToBlob('data:image/png;base64,AA==').type).toBe('image/png');
  });
});
