/**
 * `we-file-upload` lets a host take the files it holds back: a message composer lists what is
 * attached and, once the message is sent, sets `files` to `[]` so the drop zone does not go on
 * showing files that were already sent.
 */
import './file-upload';

import { describe, expect, it } from 'vitest';

interface UploadEl extends HTMLElement {
  files?: File[];
  multiple: boolean;
  updateComplete: Promise<unknown>;
}

async function mount() {
  const el = document.createElement('we-file-upload') as UploadEl;
  el.multiple = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const names = (el: UploadEl) =>
  [...(el.shadowRoot?.querySelectorAll('[part="file-item"] span') ?? [])].map((n) => n.textContent);

describe('we-file-upload files', () => {
  it('shows the files a host gives it and lets go of them when given none', async () => {
    const el = await mount();
    el.files = [new File(['a'], 'plan.pdf'), new File(['b'], 'map.png')];
    await el.updateComplete;
    expect(names(el)).toEqual(['plan.pdf', 'map.png']);

    el.files = [];
    await el.updateComplete;
    expect(names(el)).toEqual([]);
  });

  it('draws no list when the host shows the files itself', async () => {
    const el = await mount();
    (el as unknown as { hideList: boolean }).hideList = true;
    el.files = [new File(['a'], 'plan.pdf')];
    await el.updateComplete;
    expect(names(el)).toEqual([]);
  });

  it('leaves out a file over its limit, and says which', async () => {
    const el = (await mount()) as UploadEl & { maxSize: number; _addFiles: (files: File[]) => void };
    el.maxSize = 4;
    const heard: { files: File[]; names: string }[] = [];
    const changed: unknown[] = [];
    el.addEventListener('reject', (e) => heard.push((e as CustomEvent).detail));
    el.addEventListener('change', (e) => changed.push((e as CustomEvent).detail));

    el._addFiles([new File(['1234'], 'ok.txt'), new File(['12345'], 'big.bin')]);

    expect(heard.map((d) => d.names)).toEqual(['big.bin']);
    expect((changed[0] as File[]).map((f) => f.name)).toEqual(['ok.txt']);

    // Only a refused file: no change to announce.
    el._addFiles([new File(['12345'], 'big2.bin')]);
    expect(changed).toHaveLength(1);
  });
});
